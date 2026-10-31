import base64
import json
import os
import tempfile
import threading
import sys
import types
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch
from uuid import uuid4

from bridge import MAX_BODY, make_server, validate_images, validate_request
from runtime import CODEX_URL, HermesRuntime, RuntimeUnavailable


def payload():
    return {"version": 1, "requestId": str(uuid4()), "workspaceId": str(uuid4()),
            "model": "test-model", "effort": "low", "maxOutputTokens": 2000,
            "messages": [{"role": "system", "content": "trusted frame"},
                         {"role": "user", "content": "untrusted question"}],
            "responseSchema": {"type": "object"}}


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 16


def image(raw=PNG, mime="image/png"):
    return {"mimeType": mime, "base64": base64.b64encode(raw).decode()}


class FakeRuntime:
    def generate(self, request):
        return {"version": 1, "text": '{"reply":"hello"}', "model": request["model"],
                "usage": {"inputTokens": 1, "outputTokens": 2, "cachedInputTokens": 0}}


class FakeAgent:
    instances = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.tools = []
        self.closed = False
        self.instances.append(self)

    def run_conversation(self, message, **kwargs):
        self.call = (message, kwargs)
        return {"completed": True, "final_response": '{"reply":"hello"}'}

    def close(self):
        self.closed = True


class VisionAgent(FakeAgent):
    instances = []
    vision = True

    def _model_supports_vision(self):
        return self.vision


class BridgeTests(unittest.TestCase):
    def test_rejects_unknown_fields_and_model_controlled_identity(self):
        for field, value in (("tools", ["shell"]), ("databaseUrl", "secret"), ("workspaceId", "foreign"), ("workspaceId", 123), ("requestId", [])):
            with self.subTest(field=field), self.assertRaises((ValueError, TypeError)):
                validate_request({**payload(), field: value})

    def test_rejects_invalid_history_and_output_limits(self):
        for value in ({"messages": []}, {"maxOutputTokens": True}, {"maxOutputTokens": 9000},
                      {"messages": [{"role": "tool", "content": "shell output"}]}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_request({**payload(), **value})

    def test_http_requires_auth_before_runtime_and_returns_only_reply(self):
        key = "k" * 32
        server = make_server("127.0.0.1", 0, key, FakeRuntime())
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}/v1/generate"
        try:
            request = Request(url, data=json.dumps(payload()).encode(), headers={"Content-Type": "application/json"})
            with self.assertRaises(HTTPError) as error:
                urlopen(request, timeout=2)
            self.assertEqual(error.exception.code, 401)
            request.add_header("Authorization", "Bearer " + key)
            with urlopen(request, timeout=2) as response:
                self.assertEqual(json.load(response)["text"], '{"reply":"hello"}')
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_missing_private_auth_never_reads_global_credentials(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {}, clear=True):
            resolver = lambda: self.fail("must not resolve operator credentials")
            runtime = HermesRuntime(Path(temporary) / "private", "openai-codex", FakeAgent, resolver)
            with self.assertRaises(RuntimeUnavailable) as error:
                runtime.generate(payload())
            self.assertEqual(error.exception.code, "MODEL_AUTH_REQUIRED")

    def test_isolates_prompt_history_and_disables_tools_memory_and_fallback(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {}, clear=True):
            home = Path(temporary) / "private"
            runtime = HermesRuntime(home, "openai-codex", FakeAgent,
                                    lambda: {"api_key": "test", "base_url": CODEX_URL})
            auth = home / "auth.json"
            auth.write_text(json.dumps({"providers": {"openai-codex": {"tokens": {
                "access_token": "test-only", "refresh_token": "test-only"}}}}))
            auth.chmod(0o600)
            request = payload()
            self.assertEqual(runtime.generate(request)["version"], 1)
            agent = FakeAgent.instances[-1]
            self.assertEqual(agent.kwargs["enabled_toolsets"], [])
            self.assertTrue(agent.kwargs["skip_memory"])
            self.assertTrue(agent.kwargs["skip_context_files"])
            self.assertIsNone(agent.kwargs["fallback_model"])
            self.assertIn("trusted frame", agent._build_system_prompt())
            self.assertNotIn("untrusted question", agent._build_system_prompt())
            self.assertEqual(agent.call[1]["conversation_history"], [])
            self.assertTrue(agent.closed)

    def test_unsafe_auth_permissions_and_endpoint_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {}, clear=True):
            home = Path(temporary) / "private"
            runtime = HermesRuntime(home, "openai-codex", FakeAgent)
            auth = home / "auth.json"
            auth.write_text('{}')
            auth.chmod(0o644)
            with self.assertRaises(RuntimeUnavailable):
                runtime.generate(payload())
            os.environ["HERMES_CODEX_BASE_URL"] = "https://untrusted.example"
            with self.assertRaises(RuntimeUnavailable) as error:
                runtime.generate(payload())
            self.assertEqual(error.exception.code, "MODEL_ENDPOINT_REJECTED")

    def test_whitespace_credentials_cannot_recover_operator_auth(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {}, clear=True):
            home = Path(temporary) / "private"
            runtime = HermesRuntime(home, "openai-codex", FakeAgent,
                                    lambda: self.fail("must not resolve other credentials"))
            auth = home / "auth.json"
            auth.write_text(json.dumps({"providers": {"openai-codex": {"tokens": {
                "access_token": " ", "refresh_token": " "}}}}))
            auth.chmod(0o600)
            with self.assertRaises(RuntimeUnavailable):
                runtime.generate(payload())

    def test_refresh_uses_only_private_tokens_and_atomically_persists_rotation(self):
        auth_module = types.ModuleType("hermes_cli.auth")
        auth_module._codex_access_token_is_expiring = lambda token, skew: True
        calls = []

        def refresh(access, token, timeout_seconds):
            calls.append((access, token, timeout_seconds))
            return {"access_token": "new-private-access", "refresh_token": "new-private-refresh"}

        auth_module.refresh_codex_oauth_pure = refresh
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {}, clear=True), patch.dict(sys.modules, {"hermes_cli.auth": auth_module}):
            home = Path(temporary) / "private"
            runtime = HermesRuntime(home, "openai-codex", FakeAgent)
            auth = home / "auth.json"
            auth.write_text(json.dumps({"preserved": "setting", "providers": {"openai-codex": {"tokens": {
                "access_token": "old-private-access", "refresh_token": "old-private-refresh"}}}}))
            auth.chmod(0o600)
            runtime.generate(payload())
            self.assertEqual(calls, [("old-private-access", "old-private-refresh", 15)])
            persisted = json.loads(auth.read_text())
            self.assertEqual(persisted["preserved"], "setting")
            self.assertEqual(persisted["providers"]["openai-codex"]["tokens"]["refresh_token"], "new-private-refresh")
            self.assertEqual(auth.stat().st_mode & 0o777, 0o600)
            self.assertEqual(FakeAgent.instances[-1].kwargs["api_key"], "new-private-access")


TOOL = {"name": "get_time", "description": "Current time", "parameters": {"type": "object", "properties": {}}}


class NativeAgent(FakeAgent):
    """Fake of the single-call Responses path: records what the transport would receive."""
    instances = []
    response = None

    def _build_api_kwargs(self, api_messages, tools_for_api=None):
        self.api_messages = api_messages
        self.sent_tools = list(self.tools)
        return {"model": self.kwargs["model"], "tools": list(self.tools), "tool_choice": "auto",
                "prompt_cache_key": (self.kwargs.get("request_overrides") or {}).get("prompt_cache_key")}

    def _interruptible_api_call(self, api_kwargs):
        self.api_kwargs = api_kwargs
        return self.response

    def _get_transport(self):
        outer = self

        class Transport:
            def normalize_response(self, response):
                return response["normalized"]
        return Transport()

    def run_conversation(self, *args, **kwargs):
        raise AssertionError("the Hermes loop must not run for native tools")


def normalized(content=None, calls=(), finish="stop"):
    return types.SimpleNamespace(
        content=content, finish_reason=finish,
        tool_calls=[types.SimpleNamespace(id=cid + "|fc_" + cid, name=name, arguments=args,
                                          provider_data={"call_id": cid}) for cid, name, args in calls] or None)


def native_runtime(temporary, response):
    NativeAgent.response = {"normalized": response, "usage": types.SimpleNamespace(
        input_tokens=11, output_tokens=5, input_tokens_details=types.SimpleNamespace(cached_tokens=4))}
    home = Path(temporary) / "private"
    runtime = HermesRuntime(home, "openai-codex", NativeAgent, lambda: {"api_key": "test", "base_url": CODEX_URL})
    auth = home / "auth.json"
    auth.write_text(json.dumps({"providers": {"openai-codex": {"tokens": {
        "access_token": "test-only", "refresh_token": "test-only"}}}}))
    auth.chmod(0o600)
    return runtime


def tool_payload(**extra):
    return {**payload(), "responseSchema": None, "tools": [TOOL], **extra}


class NativeToolTests(unittest.TestCase):
    def run_native(self, request, response):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {}, clear=True):
            runtime = native_runtime(temporary, response)
            result = runtime.generate(request)
            return result, NativeAgent.instances[-1]

    def test_validates_tools_tool_choice_and_cache_key(self):
        validate_request(tool_payload(toolChoice="auto", promptCacheKey="bot:conv"))
        bad = ({"tools": ["shell"]}, {"tools": [{"name": "x"}]}, {"tools": [{**TOOL, "name": "bad name!"}]},
               {"toolChoice": "required"}, {"promptCacheKey": 5}, {"promptCacheKey": "x" * 300},
               {"tools": [TOOL] * 40})
        for value in bad:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_request(tool_payload(**value))

    def test_validates_tool_history_and_allows_a_tool_turn_last(self):
        history = [
            {"role": "system", "content": "frame"}, {"role": "user", "content": "q"},
            {"role": "assistant", "content": "", "toolCalls": [{"id": "call_1", "name": "get_time", "arguments": "{}"}]},
            {"role": "tool", "content": "12:00", "toolCallId": "call_1", "name": "get_time"}]
        validate_request(tool_payload(messages=history))
        for broken in (
            history[:3] + [{"role": "tool", "content": "x"}],
            [history[0], history[1], {"role": "assistant", "content": "", "toolCalls": []}, history[3]],
            history[:2] + [{"role": "assistant", "content": "a", "toolCalls": [{"id": "c", "name": "n"}]}, history[3]],
        ):
            with self.subTest(broken=broken), self.assertRaises(ValueError):
                validate_request(tool_payload(messages=broken))
        with self.assertRaises(ValueError):  # a plain assistant turn still cannot be last
            validate_request(tool_payload(messages=[history[0], history[1], {"role": "assistant", "content": "a"}]))

    def test_function_tools_reach_the_transport_and_calls_come_back(self):
        result, agent = self.run_native(
            tool_payload(promptCacheKey="bot:conv"),
            normalized(calls=[("call_9", "get_time", '{"tz":"UTC"}')], finish="tool_calls"))
        self.assertEqual(agent.sent_tools, [{"type": "function", "function": {
            "name": "get_time", "description": "Current time", "parameters": {"type": "object", "properties": {}}}}])
        self.assertEqual(agent.api_kwargs["prompt_cache_key"], "bot:conv")
        self.assertEqual(agent.api_kwargs["tool_choice"], "auto")
        self.assertEqual(result["toolCalls"], [{"id": "call_9", "name": "get_time", "arguments": '{"tz":"UTC"}'}])
        self.assertEqual(result["stopReason"], "tool_use")
        self.assertEqual(result["text"], "")
        self.assertEqual(result["usage"], {"inputTokens": 7, "outputTokens": 5, "cachedInputTokens": 4})
        self.assertTrue(agent.closed)

    def test_text_answer_without_calls_ends(self):
        result, _ = self.run_native(tool_payload(), normalized(content="  xin chao  "))
        self.assertEqual((result["text"], result["toolCalls"], result["stopReason"]), ("xin chao", [], "end"))

    def test_length_finish_is_max_tokens(self):
        result, _ = self.run_native(tool_payload(), normalized(content="cut", finish="length"))
        self.assertEqual(result["stopReason"], "max_tokens")

    def test_empty_reply_without_calls_fails(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {}, clear=True):
            runtime = native_runtime(temporary, normalized(content="  "))
            with self.assertRaises(RuntimeUnavailable) as error:
                runtime.generate(tool_payload())
            self.assertEqual(error.exception.code, "MODEL_REPLY_FAILED")

    def test_tool_choice_none_keeps_tools_but_forbids_calls(self):
        _, agent = self.run_native(tool_payload(toolChoice="none"), normalized(content="ok"))
        self.assertEqual(len(agent.api_kwargs["tools"]), 1)
        self.assertEqual(agent.api_kwargs["tool_choice"], "none")

    def test_history_becomes_chat_tool_messages_for_the_transport(self):
        history = [
            {"role": "system", "content": "frame"}, {"role": "user", "content": "q"},
            {"role": "assistant", "content": "", "toolCalls": [{"id": "call_1", "name": "get_time", "arguments": "{}"}]},
            {"role": "tool", "content": "12:00", "toolCallId": "call_1", "name": "get_time"}]
        _, agent = self.run_native(tool_payload(messages=history), normalized(content="done"))
        self.assertEqual(agent.api_messages, [
            {"role": "system", "content": "frame"}, {"role": "user", "content": "q"},
            {"role": "assistant", "content": "", "tool_calls": [
                {"id": "call_1", "type": "function", "function": {"name": "get_time", "arguments": "{}"}}]},
            {"role": "tool", "tool_call_id": "call_1", "name": "get_time", "content": "12:00"}])

    def test_the_bridge_never_executes_a_tool(self):
        executed = []
        agent_tool = types.SimpleNamespace(call=lambda *a: executed.append(a))
        _, agent = self.run_native(tool_payload(), normalized(calls=[("c", "get_time", "{}")], finish="tool_calls"))
        self.assertEqual(executed, [])
        self.assertFalse(hasattr(agent, "handle_function_call"))
        self.assertEqual(agent.kwargs["enabled_toolsets"], [])

    def test_tool_mode_requires_empty_builtin_toolset(self):
        class Loaded(NativeAgent):
            def __init__(self, **kwargs):
                super().__init__(**kwargs)
                self.tools = [{"type": "function", "function": {"name": "terminal"}}]
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {}, clear=True):
            runtime = native_runtime(temporary, normalized(content="x"))
            runtime.agent_class = Loaded
            with self.assertRaises(RuntimeUnavailable) as error:
                runtime.generate(tool_payload())
            self.assertEqual(error.exception.code, "TOOLSET_MISMATCH")

    def test_busy_bridge_answers_429_with_a_clamped_retry_after(self):
        release, entered = threading.Event(), threading.Event()

        class Slow:
            def generate(self, request):
                entered.set()
                release.wait(5)
                return FakeRuntime().generate(request)

        key = "k" * 32
        server = make_server("127.0.0.1", 0, key, Slow())
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}/v1/generate"

        def post():
            return Request(url, data=json.dumps(payload()).encode(),
                           headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})

        first = threading.Thread(target=lambda: urlopen(post(), timeout=10).read(), daemon=True)
        try:
            first.start()
            self.assertTrue(entered.wait(2))
            with self.assertRaises(HTTPError) as error:
                urlopen(post(), timeout=2)
            self.assertEqual(error.exception.code, 429)
            retry_after = int(error.exception.headers["Retry-After"])
            self.assertTrue(1 <= retry_after <= 30, retry_after)
            self.assertEqual(retry_after, 30)  # a turn just started: ~50 s remain, clamped to 30
        finally:
            release.set()
            first.join(timeout=5)
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_prompt_cache_key_also_reaches_the_plain_loop(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {}, clear=True):
            home = Path(temporary) / "private"
            runtime = HermesRuntime(home, "openai-codex", FakeAgent, lambda: {"api_key": "test", "base_url": CODEX_URL})
            (home / "auth.json").write_text(json.dumps({"providers": {"openai-codex": {"tokens": {
                "access_token": "t", "refresh_token": "t"}}}}))
            (home / "auth.json").chmod(0o600)
            runtime.generate({**payload(), "promptCacheKey": "bot:conv"})
            self.assertEqual(FakeAgent.instances[-1].kwargs["request_overrides"], {"prompt_cache_key": "bot:conv"})

    def test_health_reports_native_tools(self):
        key = "k" * 32
        server = make_server("127.0.0.1", 0, key, FakeRuntime())
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with urlopen(f"http://127.0.0.1:{server.server_port}/health", timeout=2) as response:
                self.assertEqual(json.load(response), {"status": "up", "runtime": "hermes", "version": 1, "nativeTools": True})
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


class ImageValidationTests(unittest.TestCase):
    def test_accepts_allowed_types_with_matching_magic_bytes(self):
        images = [image(PNG), image(JPEG, "image/jpeg"), image(WEBP, "image/webp")]
        self.assertEqual(validate_request({**payload(), "images": images})["images"], images)

    def test_rejects_bad_images(self):
        big = b"\x89PNG\r\n\x1a\n" + b"\x00" * 3_000_000
        cases = {
            "too many": [image()] * 4,
            "empty list": [],
            "not a list": "x",
            "gif": [image(b"GIF89a....", "image/gif")],
            "mime mismatch": [image(PNG, "image/jpeg")],
            "not an image": [image(b"hello world")],
            "bad base64": [{"mimeType": "image/png", "base64": "not base64!!"}],
            "url instead of bytes": [{"mimeType": "image/png", "url": "https://x.test/a.png"}],
            "extra key": [{**image(), "url": "https://x.test/a.png"}],
            "one over 3 MB": [image(big)],
            "over 6 MB total": [image(b"\x89PNG\r\n\x1a\n" + b"\x00" * 2_500_000)] * 3,
        }
        for name, images in cases.items():
            with self.subTest(name), self.assertRaises(ValueError):
                validate_images(images)

    def test_runtime_attaches_images_to_the_last_user_message_only(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {}, clear=True):
            runtime = HermesRuntime(Path(temporary) / "private", "openai-codex", VisionAgent,
                                    lambda: {"api_key": "test", "base_url": CODEX_URL})
            auth = Path(temporary) / "private" / "auth.json"
            auth.write_text(json.dumps({"providers": {"openai-codex": {"tokens": {
                "access_token": "test-only", "refresh_token": "test-only"}}}}))
            auth.chmod(0o600)
            request = {**payload(), "images": [image()]}
            request["messages"] = [{"role": "user", "content": "earlier"}, {"role": "assistant", "content": "ok"},
                                   {"role": "user", "content": "what is this?"}]
            runtime.generate(request)
            message, kwargs = VisionAgent.instances[-1].call
            self.assertEqual(message[0], {"type": "text", "text": "what is this?"})
            self.assertEqual(message[1]["type"], "image_url")
            self.assertTrue(message[1]["image_url"]["url"].startswith("data:image/png;base64,"))
            self.assertEqual(kwargs["conversation_history"][0], {"role": "user", "content": "earlier"})
            # No images: the message stays a plain string.
            runtime.generate(payload())
            self.assertEqual(VisionAgent.instances[-1].call[0], "untrusted question")

    def test_fails_closed_when_the_model_cannot_take_images(self):
        class TextOnlyAgent(VisionAgent):
            vision = False

        class UnawareAgent(FakeAgent):
            pass

        for agent_class in (TextOnlyAgent, UnawareAgent):
            with self.subTest(agent_class.__name__), tempfile.TemporaryDirectory() as temporary, \
                    patch.dict(os.environ, {}, clear=True):
                runtime = HermesRuntime(Path(temporary) / "private", "openai-codex", agent_class,
                                        lambda: {"api_key": "test", "base_url": CODEX_URL})
                auth = Path(temporary) / "private" / "auth.json"
                auth.write_text(json.dumps({"providers": {"openai-codex": {"tokens": {
                    "access_token": "test-only", "refresh_token": "test-only"}}}}))
                auth.chmod(0o600)
                with self.assertRaises(RuntimeUnavailable) as error:
                    runtime.generate({**payload(), "images": [image()]})
                self.assertEqual(error.exception.code, "VISION_UNSUPPORTED")
                self.assertFalse(hasattr(agent_class.instances[-1], "call"))
                self.assertTrue(agent_class.instances[-1].closed)

    def test_http_allows_a_large_body_only_for_images(self):
        class Vision:
            def generate(self, request):
                return {"version": 1, "text": str(len(request.get("images") or [])), "model": "m",
                        "usage": {"inputTokens": 1, "outputTokens": 1, "cachedInputTokens": 0}}

        key = "k" * 32
        server = make_server("127.0.0.1", 0, key, Vision())
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}/v1/generate"
        headers = {"Content-Type": "application/json", "Authorization": "Bearer " + key}
        big = b"\x89PNG\r\n\x1a\n" + b"\x01" * 2_000_000
        try:
            with urlopen(Request(url, data=json.dumps({**payload(), "images": [image(big)]}).encode(),
                                 headers=headers), timeout=10) as response:
                self.assertEqual(json.load(response)["text"], "1")
            padded = payload()
            padded["messages"][1]["content"] = "x" * 80_000
            padded["messages"].insert(1, {"role": "assistant", "content": "y" * 80_000})
            padded["messages"].insert(1, {"role": "user", "content": "z" * 80_000})
            padded["messages"].insert(1, {"role": "assistant", "content": "w" * 80_000})
            for body in (padded, {**padded, "images": [image()]}):
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(url, data=json.dumps(body).encode(), headers=headers), timeout=10)
                self.assertEqual(error.exception.code, 413)
            self.assertGreater(len(json.dumps(padded)), MAX_BODY)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


class WarmUpTests(unittest.TestCase):
    def test_warm_up_never_raises_without_hermes_installed(self):
        with tempfile.TemporaryDirectory() as home:
            os.chmod(home, 0o700)
            with patch.dict(sys.modules, {"run_agent": None}):
                HermesRuntime(home, "openai-codex").warm_up()


class ModelListTests(unittest.TestCase):
    def runtime(self, ids, home, token="access"):
        auth = Path(home) / "auth.json"
        auth.write_text(json.dumps({"providers": {"openai-codex": {"tokens": {
            "access_token": token, "refresh_token": "refresh"}}}}))
        auth.chmod(0o600)
        seen = []

        def lister(value):
            seen.append(value)
            return ids

        runtime = HermesRuntime(home, "openai-codex", credential_resolver=lambda: {"api_key": token, "base_url": CODEX_URL},
                                model_lister=lister)
        return runtime, seen

    def test_lists_base_models_without_long_context_aliases(self):
        with tempfile.TemporaryDirectory() as home:
            os.chmod(home, 0o700)
            runtime, seen = self.runtime(["gpt-5.6-sol", "gpt-5.6-sol-900k", "gpt-5.5", "gpt-5.5", " "], home)
            self.assertEqual(runtime.models(), ["gpt-5.6-sol", "gpt-5.5"])
            self.assertEqual(seen, ["access"])

    def test_requires_a_sign_in_and_hides_lister_failures(self):
        with tempfile.TemporaryDirectory() as home:
            os.chmod(home, 0o700)
            signed_out = HermesRuntime(home, "openai-codex", model_lister=lambda _t: ["x"])
            with self.assertRaises(RuntimeUnavailable) as error:
                signed_out.models()
            self.assertEqual(error.exception.code, "MODEL_AUTH_REQUIRED")
            runtime, _ = self.runtime([], home)
            runtime.model_lister = lambda _t: (_ for _ in ()).throw(RuntimeError("secret detail"))
            with self.assertRaises(RuntimeUnavailable) as error:
                runtime.models()
            self.assertEqual(error.exception.code, "MODEL_LIST_FAILED")
            self.assertNotIn("secret", str(error.exception))


if __name__ == "__main__":
    unittest.main()
