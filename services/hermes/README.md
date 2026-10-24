# Isolated Hermes runtime

This private Python process adapts the existing Hermes AIAgent used by booking-agent. NestJS owns tenant authorization, retrieval, conversation state, grounding and delivery; Hermes sees only the explicit request context. Replace `HermesProvider` to change the runtime without moving platform logic.

## Start

Use Python 3.11–3.13 with Hermes installed. The existing development checkout provides a compatible environment at `/home/kenknight/Workspace/NetClaw_1.1.0/booking-agent/.venv/bin/python`; no source files or credentials are copied from that project.

```bash
cd services/hermes
# Set HERMES_BRIDGE_KEY to an independently generated secret of 32+ characters.
# Keep it in a private environment file or secret manager, never in source control.
# RAPIZ_HERMES_HOME defaults to ./var/hermes-home, a private directory with mode 700.
# RAPIZ_HERMES_PROVIDER defaults to openai-codex; openrouter requires explicit selection.
python bridge.py
```

The server binds only to `127.0.0.1:8788`. `HERMES_BRIDGE_PORT` changes the port. `GET /health` proves the process is up, not model access. In the platform admin LLM settings, add a **Hermes** provider with base URL `http://127.0.0.1:8788`, the bridge secret in the write-only API-key field, and a tier route with an explicitly permitted model. The bridge key is not a model API key. Missing or failed Hermes never silently switches to paid API usage; any tier fallback is an explicit platform-admin configuration.

## Separate ChatGPT login

Set the exact same private `HERMES_HOME` used by `RAPIZ_HERMES_HOME` when running the installed `hermes model` command; choose OpenAI Codex/ChatGPT and complete a separate login. The runtime requires a private singleton `auth.json`, mode 600, in that home. Only that private file is refreshed atomically; the higher-level Hermes resolver is intentionally bypassed because it may recover an operator CLI session. It refuses missing/unsafe credentials before invoking the Hermes pure OAuth refresh helper. Do not copy the active Booking or Codex CLI session: rotating the same refresh token from multiple processes can invalidate it. Signing in does not add quota.

The inherited Codex transport is isolated for compatibility with the existing runtime. Successful local authentication is not production acceptance or proof of commercial eligibility. The official [ChatGPT plan usage documentation](https://developers.openai.com/siwc/token-sharing-open-source) distinguishes local/open-source integrations from paid/hosted applications, which require the appropriate registration/access. Checked 2026-10-24. No automatic login, consent or paid provider fallback occurs in customer turns.

For an explicitly chosen OpenRouter deployment, set `RAPIZ_HERMES_PROVIDER=openrouter` and `RAPIZ_OPENROUTER_API_KEY` privately. This does not enable a fallback from subscription authentication.

## Contract and controls

`POST /v1/generate` requires a constant-time checked bearer bridge key and JSON body, capped at 256 KB. Version 1 carries request/workspace UUIDs, model, reasoning effort, bounded messages, output budget and optional JSON schema. The process permits one active turn and returns 429 while busy. Messages/context are not logged. Credentials and provider exception text never enter HTTP error bodies.

Each turn creates a fresh AIAgent with memory, context files, background review, trajectories and provider fallback disabled. It exposes no tools; the instantiated tool list is checked before inference. Knowledge and scenario context come from NestJS. Booking villa tools, database access, arbitrary callbacks and delivery are deliberately absent. New tools must use server-bound identities and a reviewed allowlist.

Hermes enforces its configured 50-second run budget and iteration limit; the TypeScript caller also has a transport timeout. Subscription transports may not support a hard output-token cap. The bridge is single-flight; use bounded platform worker concurrency rather than opening it publicly. Production deployment needs service supervision and private network access, plus capacity testing.

## Verify

```bash
python3 -m unittest discover -s services/hermes -p 'test_*.py' -v
pnpm --filter @agent-sales/ai-core test
```

Tests use synthetic credentials/fake agents and a loopback HTTP server. They do not read real auth files or call a paid model. Model inference and the exact installed Hermes version require a separate live acceptance probe.
