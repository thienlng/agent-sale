"""The only Python module importing Hermes; adapted from booking-agent's isolated bridge."""

import json
import logging
import os
import sys
import tempfile
from pathlib import Path

CODEX_URL = "https://chatgpt.com/backend-api/codex"


class RuntimeUnavailable(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class HermesRuntime:
    def __init__(self, home, provider, agent_class=None, credential_resolver=None):
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
        self.home.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.home.stat().st_mode & 0o077:
            raise ValueError("private Hermes home permissions must be 700")
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
        auth = self.home / "auth.json"
        try:
            if auth.is_symlink() or auth.stat().st_mode & 0o077:
                raise ValueError("private auth permissions")
            state = json.loads(auth.read_text(encoding="utf-8-sig"))
            tokens = state["providers"]["openai-codex"]["tokens"]
            if not all(isinstance(tokens.get(k), str) and tokens[k].strip() for k in ("access_token", "refresh_token")):
                raise ValueError("missing tokens")
        except (OSError, ValueError, TypeError, KeyError):
            raise RuntimeUnavailable("MODEL_AUTH_REQUIRED") from None
        try:
            resolver = self.credential_resolver
            if resolver is None:
                # The higher-level resolver can recover the operator's global CLI
                # session. Use Hermes' pure refresh helper on this private store only.
                from hermes_cli.auth import _codex_access_token_is_expiring, refresh_codex_oauth_pure
                if _codex_access_token_is_expiring(tokens["access_token"], 60):
                    refreshed = refresh_codex_oauth_pure(tokens["access_token"], tokens["refresh_token"], timeout_seconds=15)
                    tokens.update({"access_token": refreshed["access_token"], "refresh_token": refreshed["refresh_token"]})
                    descriptor, name = tempfile.mkstemp(prefix="auth-", dir=self.home)
                    try:
                        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                            json.dump(state, output)
                            output.flush()
                            os.fsync(output.fileno())
                        os.replace(name, auth)
                    finally:
                        if os.path.exists(name):
                            os.unlink(name)
                value = {"api_key": tokens["access_token"], "base_url": CODEX_URL}
            else:
                value = resolver()
            if value.get("base_url", "").rstrip("/") != CODEX_URL or not value.get("api_key"):
                raise RuntimeUnavailable("MODEL_AUTH_REQUIRED")
            return {"provider": "openai-codex", "api_mode": "codex_responses", "base_url": CODEX_URL, "api_key": value["api_key"]}
        except Exception:
            raise RuntimeUnavailable("MODEL_AUTH_REQUIRED") from None

    def generate(self, request):
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
            # Keep Hermes' operator scaffold and local identity out of customer-facing prompts.
            agent._build_system_prompt = lambda system_message=None: system
            agent._cached_system_prompt_static = system
            result = agent.run_conversation(messages[-1]["content"], conversation_history=history,
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
