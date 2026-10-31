"""The only Python module importing Hermes; adapted from booking-agent's isolated bridge."""

import json
import logging
import os
import sys
from pathlib import Path

from authstore import AuthStore

CODEX_URL = "https://chatgpt.com/backend-api/codex"


class RuntimeUnavailable(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class HermesRuntime:
    def __init__(self, home, provider, agent_class=None, credential_resolver=None, model_lister=None,
                 token_refresher=None, expiry_check=None):
        raw_home = Path(home).expanduser()
        if raw_home.is_symlink():
            raise ValueError("private Hermes home cannot be a symlink")
        self.home = raw_home.resolve()
        if self.home == (Path.home() / ".hermes").resolve():
            raise ValueError("operator Hermes home cannot be used")
        if provider not in ("openai-codex", "openrouter"):
            raise ValueError("unsupported Hermes provider")
        self.provider = provider
        self.agent_class = agent_class
        self.credential_resolver = credential_resolver
        self.model_lister = model_lister
        self.token_refresher = token_refresher  # (access, refresh) -> {access_token, refresh_token}
        self.expiry_check = expiry_check  # (access_token) -> bool; injected by tests
        self.home.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.home.stat().st_mode & 0o077:
            raise ValueError("private Hermes home permissions must be 700")
        self.store = AuthStore(self.home)
        current = os.environ.get("HERMES_HOME")
        if "hermes_constants" in sys.modules and current != str(self.home):
            raise ValueError("Hermes already imported with another home")
        os.environ["HERMES_HOME"] = str(self.home)
        config = self.home / "config.yaml"
        if config.is_symlink():
            raise ValueError("private config cannot be a symlink")
        config.write_text("""# Generated private Rapiz runtime settings.
agent:
  task_completion_guidance: false
  environment_probe: false
  bot_mode_protocol: false
security:
  allow_lazy_installs: false
memory:
  memory_enabled: false
  user_profile_enabled: false
tools:
  tool_search:
    enabled: off
""", encoding="utf-8")
        config.chmod(0o600)

    def _credentials(self):
        if self.provider == "openrouter":
            key = os.environ.get("RAPIZ_OPENROUTER_API_KEY")
            if not key:
                raise RuntimeUnavailable("MODEL_AUTH_REQUIRED")
            return {"provider": "openrouter", "base_url": "https://openrouter.ai/api/v1", "api_key": key}
        if os.environ.get("HERMES_CODEX_BASE_URL", CODEX_URL).rstrip("/") != CODEX_URL:
            raise RuntimeUnavailable("MODEL_ENDPOINT_REJECTED")
        with self.store.lock():
            state = self.store.read()
        if state is None:
            raise RuntimeUnavailable("MODEL_AUTH_REQUIRED")
        tokens = dict(self.store.tokens(state))
        try:
            resolver = self.credential_resolver
            if resolver is None:
                tokens = self._fresh_tokens(tokens)
                value = {"api_key": tokens["access_token"], "base_url": CODEX_URL}
            else:
                value = resolver()
            if value.get("base_url", "").rstrip("/") != CODEX_URL or not value.get("api_key"):
                raise RuntimeUnavailable("MODEL_AUTH_REQUIRED")
            return {"provider": "openai-codex", "api_mode": "codex_responses", "base_url": CODEX_URL, "api_key": value["api_key"]}
        except Exception:
            raise RuntimeUnavailable("MODEL_AUTH_REQUIRED") from None

    def _fresh_tokens(self, tokens):
        """Refresh an expiring access token. The auth lock is held only for the file access.

        Read under the lock (done by the caller), refresh at OpenAI outside it, then re-lock and
        write only if auth.json still holds the refresh token we used. A logout (file gone) or a
        new sign-in (different refresh token) in the meantime wins: the refreshed pair is dropped.
        """
        check, refresh = self.expiry_check, self.token_refresher
        if check is None or refresh is None:
            # The higher-level resolver can recover the operator's global CLI session.
            # Use Hermes' pure refresh helper on this private store only.
            from hermes_cli.auth import _codex_access_token_is_expiring, refresh_codex_oauth_pure
            check = check or (lambda token: _codex_access_token_is_expiring(token, 60))
            refresh = refresh or (lambda access, refresh_token: refresh_codex_oauth_pure(
                access, refresh_token, timeout_seconds=15))
        if not check(tokens["access_token"]):
            return tokens
        refreshed = refresh(tokens["access_token"], tokens["refresh_token"])
        new = {"access_token": refreshed["access_token"], "refresh_token": refreshed["refresh_token"]}
        with self.store.lock():
            current = self.store.read()
            if current is None or self.store.tokens(current)["refresh_token"] != tokens["refresh_token"]:
                raise RuntimeUnavailable("MODEL_AUTH_REQUIRED")
            self.store.tokens(current).update(new)
            self.store.write(current)
        return new

    def warm_up(self):
        """Imports the heavy Hermes modules so the first customer turn is not the slow one."""
        try:
            import run_agent  # noqa: F401
            import hermes_cli.auth  # noqa: F401
        except Exception:
            pass  # a missing install is reported by generate() with its own error code

    def models(self):
        """Model ids the signed-in ChatGPT plan can use, best first (live catalog, curated fallback).

        The ``-900k`` entries are Hermes-side long-context aliases of a base model, so they are
        dropped to keep the picker short.
        """
        if self.provider != "openai-codex":
            return []
        token = self._credentials()["api_key"]
        lister = self.model_lister
        if lister is None:
            try:
                from hermes_cli.codex_models import get_codex_model_ids as lister
            except ImportError:
                raise RuntimeUnavailable("HERMES_NOT_INSTALLED") from None
        try:
            ids = lister(token)
        except Exception:
            raise RuntimeUnavailable("MODEL_LIST_FAILED") from None
        seen, result = set(), []
        for model_id in ids:
            if isinstance(model_id, str) and model_id.strip() and not model_id.endswith("-900k") \
                    and model_id not in seen:
                seen.add(model_id)
                result.append(model_id.strip())
        return result

    def generate(self, request):
        native = bool(request.get("tools"))
        credentials = self._credentials()
        agent_class = self.agent_class
        if agent_class is None:
            try:
                from run_agent import AIAgent
                agent_class = AIAgent
            except ImportError:
                raise RuntimeUnavailable("HERMES_NOT_INSTALLED") from None
        logging.getLogger("agent.turn_context").setLevel(logging.WARNING)
        messages = request["messages"]
        system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
        if request.get("responseSchema"):
            system += "\nReturn only valid JSON matching this schema:\n" + json.dumps(request["responseSchema"])
        history = [m for m in messages[:-1] if m["role"] != "system"]
        cache_key = request.get("promptCacheKey")
        agent = agent_class(
            **credentials, model=request["model"], max_iterations=3,
            max_tokens=request.get("maxOutputTokens", 2000),
            enabled_toolsets=[], quiet_mode=True, platform="rapiz",
            skip_memory=True, skip_context_files=True, load_soul_identity=False,
            skip_background_review=True, save_trajectories=False, fallback_model=None,
            reasoning_config={"effort": request["effort"]} if request.get("effort") else None,
            run_budget_seconds=50.0,
        )
        try:
            if agent.tools:
                raise RuntimeUnavailable("TOOLSET_MISMATCH")
            if cache_key:
                # Hermes forwards request_overrides into the Responses body (prompt_cache_key).
                agent.request_overrides = {"prompt_cache_key": cache_key}
            if native:
                return self._generate_native(agent, request, system)
            # Keep Hermes' operator scaffold and local identity out of customer-facing prompts.
            agent._build_system_prompt = lambda system_message=None: system
            agent._cached_system_prompt_static = system
            user_message = messages[-1]["content"]
            images = request.get("images")
            if images:
                # Hermes silently strips image parts for a model it does not know to be vision
                # capable; refuse instead of answering as if the customer had sent no picture.
                supports = getattr(agent, "_model_supports_vision", None)
                if not callable(supports) or supports() is not True:
                    raise RuntimeUnavailable("VISION_UNSUPPORTED")
                user_message = [{"type": "text", "text": user_message}] + [
                    {"type": "image_url",
                     "image_url": {"url": f"data:{image['mimeType']};base64,{image['base64']}"}}
                    for image in images]
            result = agent.run_conversation(user_message, conversation_history=history,
                                            task_id="rapiz-" + request["requestId"])
            if (not isinstance(result, dict) or result.get("failed") or not result.get("completed", True)
                    or not isinstance(result.get("final_response"), str) or not result["final_response"].strip()):
                raise RuntimeUnavailable("MODEL_REPLY_FAILED")
            return {"version": 1, "text": result["final_response"].strip(), "model": request["model"],
                    "usage": {"inputTokens": int(result.get("input_tokens", 0)),
                              "outputTokens": int(result.get("output_tokens", 0)), "cachedInputTokens": 0}}
        finally:
            try:
                agent.close()
            except Exception:
                pass

    def _generate_native(self, agent, request, system):
        """ONE Responses call with function tools; Hermes' own tool loop is never entered.

        The tools are set on the agent only after the empty-toolset check, so Hermes' transport
        builds the request (tool schema, tool_choice, cache key, reasoning) exactly as it would
        for its own calls. The raw output items are normalized and returned; no tool is executed.
        """
        agent.tools = [{"type": "function", "function": {
            "name": t["name"], "description": t["description"], "parameters": t["parameters"]}}
            for t in request["tools"]]
        messages = [{"role": "system", "content": system}]
        for m in request["messages"]:
            if m["role"] == "system":
                continue
            if m["role"] == "assistant" and m.get("toolCalls"):
                messages.append({"role": "assistant", "content": m["content"], "tool_calls": [
                    {"id": c["id"], "type": "function",
                     "function": {"name": c["name"], "arguments": c["arguments"]}} for c in m["toolCalls"]]})
            elif m["role"] == "tool":
                tool = {"role": "tool", "tool_call_id": m["toolCallId"], "content": m["content"]}
                if m.get("name"):
                    tool["name"] = m["name"]
                messages.append(tool)
            else:
                messages.append({"role": m["role"], "content": m["content"]})
        images = request.get("images")
        if images:
            supports = getattr(agent, "_model_supports_vision", None)
            if not callable(supports) or supports() is not True:
                raise RuntimeUnavailable("VISION_UNSUPPORTED")
            messages[-1]["content"] = [{"type": "text", "text": messages[-1]["content"]}] + [
                {"type": "image_url", "image_url": {"url": f"data:{i['mimeType']};base64,{i['base64']}"}}
                for i in images]
        api_kwargs = agent._build_api_kwargs(messages)
        if request.get("toolChoice") == "none":
            api_kwargs["tool_choice"] = "none"
        response = agent._interruptible_api_call(api_kwargs)
        normalized = agent._get_transport().normalize_response(response)
        calls = []
        for call in getattr(normalized, "tool_calls", None) or []:
            provider_data = getattr(call, "provider_data", None) or {}
            call_id = provider_data.get("call_id") or str(call.id).split("|", 1)[0]
            calls.append({"id": call_id, "name": call.name,
                          "arguments": call.arguments if isinstance(call.arguments, str)
                          else json.dumps(call.arguments or {})})
        text = (getattr(normalized, "content", None) or "").strip()
        if not calls and not text:
            raise RuntimeUnavailable("MODEL_REPLY_FAILED")
        finish = getattr(normalized, "finish_reason", "stop")
        stop = "tool_use" if calls else "max_tokens" if finish == "length" else "end"
        return {"version": 1, "text": text, "toolCalls": calls, "stopReason": stop, "model": request["model"],
                "usage": self._usage(getattr(response, "usage", None) if not isinstance(response, dict)
                                     else response.get("usage"))}

    @staticmethod
    def _usage(raw):
        """Codex Responses usage: input_tokens includes cached tokens; report them separately."""
        if raw is None:
            return {"inputTokens": 0, "outputTokens": 0, "cachedInputTokens": 0}
        details = getattr(raw, "input_tokens_details", None)
        cached = int(getattr(details, "cached_tokens", 0) or 0)
        total = int(getattr(raw, "input_tokens", 0) or 0)
        return {"inputTokens": max(total - cached, 0), "outputTokens": int(getattr(raw, "output_tokens", 0) or 0),
                "cachedInputTokens": cached}
