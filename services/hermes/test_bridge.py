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

from bridge import make_server, validate_request
from runtime import CODEX_URL, HermesRuntime, RuntimeUnavailable


def payload():
    return {"version": 1, "requestId": str(uuid4()), "workspaceId": str(uuid4()),
            "model": "test-model", "effort": "low", "maxOutputTokens": 2000,
            "messages": [{"role": "system", "content": "trusted frame"},
                         {"role": "user", "content": "untrusted question"}],
            "responseSchema": {"type": "object"}}


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


if __name__ == "__main__":
    unittest.main()
