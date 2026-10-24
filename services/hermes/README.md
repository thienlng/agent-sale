# Isolated Hermes runtime

This private Python process adapts the existing Hermes AIAgent used by booking-agent. NestJS owns tenant authorization, retrieval, conversation state, grounding and delivery; Hermes sees only the explicit request context. Replace `HermesProvider` to change the runtime without moving platform logic.

## Start

Use Python 3.11–3.13 with Hermes installed in a virtual environment of your own. The runtime calls Hermes internals (`run_budget_seconds`, `load_soul_identity`, `skip_background_review`, the system-prompt hooks in `runtime.py`), so a different Hermes version can fail every turn with `502 RUNTIME_FAILED`. **The verified version is not pinned yet (T-050): treat the bridge as dev/staging only until it is.** No source files or credentials are copied from booking-agent.

```bash
cd services/hermes
# Set HERMES_BRIDGE_KEY to an independently generated secret of 32+ characters.
# Keep it in a private environment file or secret manager, never in source control.
# RAPIZ_HERMES_HOME defaults to ./var/hermes-home, a private directory with mode 700.
# RAPIZ_HERMES_PROVIDER defaults to openai-codex; openrouter requires explicit selection.
python bridge.py
```

Run **one bridge per `HERMES_HOME`**: each instance needs its own private home and its own login, because two processes rotating the same refresh token log each other out. The platform's `HermesProvider` waits at least 70 s per turn (50 s run budget + 15 s refresh), so a slow turn is never abandoned while it still holds the single slot.

The server binds only to `127.0.0.1:8788`. `HERMES_BRIDGE_PORT` changes the port. `GET /health` proves the process is up, not model access. In the platform admin LLM settings, add a **Hermes** provider with base URL `http://127.0.0.1:8788`, the bridge secret in the write-only API-key field, and a tier route with an explicitly permitted model. The bridge key is not a model API key. Missing or failed Hermes never silently switches to paid API usage; any tier fallback is an explicit platform-admin configuration.

## Sign in from the Admin page

A platform admin signs the runtime in to ChatGPT from **Admin → LLM** (the Hermes provider's "Tài khoản ChatGPT" panel): the button starts OpenAI's device-code flow, the page shows a code and a link, and the admin approves it in another tab. The bridge (`login.py`) polls OpenAI no faster than its interval, gives up after 15 minutes and writes the private `auth.json` (mode 600) itself. Endpoints, all requiring the bridge bearer key and never returning tokens: `GET /v1/auth/status`, `POST /v1/auth/start`, `POST /v1/auth/logout` (the two POSTs must have no body, else 400), plus `GET /v1/models` (the plan's model list for the Admin model picker). The bridge only redeems the approved code while something polls `status`, so the admin must keep the Admin page open until sign-in completes. Nothing signs in during customer turns.

`auth.json` has one owner: sign-in, token refresh and logout all lock `<HERMES_HOME>/.auth.lock` (`authstore.py`, `flock`, mode 600) for their read-modify-write and never hold it during network calls. A refresh whose stored refresh token changed or vanished (logout or new sign-in in the meantime) is discarded and the turn fails with `MODEL_AUTH_REQUIRED`. **Logout is local only**: Hermes has no documented OpenAI revocation endpoint, so it deletes `auth.json` but does not revoke the token at OpenAI; revoke it in the ChatGPT account settings if needed. The backend exposes the panel only outside production unless `HERMES_SUBSCRIPTION_LOGIN=true` (eligibility of ChatGPT plans for a hosted product is pending an owner decision). The terminal method below still works.

## Separate ChatGPT login (terminal)

Set the exact same private `HERMES_HOME` used by `RAPIZ_HERMES_HOME` when running the installed `hermes model` command; choose OpenAI Codex/ChatGPT and complete a separate login. The runtime requires a private singleton `auth.json`, mode 600, in that home. Only that private file is refreshed atomically; the higher-level Hermes resolver is intentionally bypassed because it may recover an operator CLI session. It refuses missing/unsafe credentials before invoking the Hermes pure OAuth refresh helper. Do not copy the active Booking or Codex CLI session: rotating the same refresh token from multiple processes can invalidate it. Signing in does not add quota.

The inherited Codex transport is isolated for compatibility with the existing runtime. Successful local authentication is not production acceptance or proof of commercial eligibility. The official [ChatGPT plan usage documentation](https://developers.openai.com/siwc/token-sharing-open-source) distinguishes local/open-source integrations from paid/hosted applications, which require the appropriate registration/access. Checked 2026-10-24. No automatic login, consent or paid provider fallback occurs in customer turns.

For an explicitly chosen OpenRouter deployment, set `RAPIZ_HERMES_PROVIDER=openrouter` and `RAPIZ_OPENROUTER_API_KEY` privately. This does not enable a fallback from subscription authentication.

## Contract and controls

`POST /v1/generate` requires a constant-time checked bearer bridge key and JSON body, capped at 256 KB. Version 1 carries request/workspace UUIDs, model, reasoning effort, bounded messages, output budget and optional JSON schema. The process permits one active turn and returns 429 while busy. Messages/context are not logged. Credentials and provider exception text never enter HTTP error bodies.

Each turn creates a fresh AIAgent with memory, context files, background review, trajectories and provider fallback disabled. It exposes no tools; the instantiated tool list is checked before inference. Knowledge and scenario context come from NestJS. Booking villa tools, database access, arbitrary callbacks and delivery are deliberately absent. New tools must use server-bound identities and a reviewed allowlist.

**Images (T-053, testing only).** `POST /v1/generate` also accepts `images: [{mimeType, base64}]` on the last user message: max 3, each at most 3 MB decoded (6 MB total), `image/jpeg|png|webp`, strict base64 and magic bytes; the bridge never fetches URLs. Body cap 256 KB for text, larger only when images are present (30 s read timeout). The images go to the model provider, so the ChatGPT-plan login is for testing only. A model that Hermes does not know to support vision fails the turn with `503 VISION_UNSUPPORTED`; images are never dropped silently. Verified live 2026-10-24 with gpt-6.1-sol, gpt-5.6-luna and gpt-6-luna.

Hermes enforces its configured 50-second run budget and iteration limit; the TypeScript caller also has a transport timeout. Subscription transports may not support a hard output-token cap. The bridge is single-flight; use bounded platform worker concurrency rather than opening it publicly. Production deployment needs service supervision and private network access, plus capacity testing.

## Verify

```bash
python3 -m unittest discover -s services/hermes -p 'test_*.py' -v   # includes the auth.json race tests
pnpm --filter @agent-sales/ai-core test
```

Tests use synthetic credentials/fake agents and a loopback HTTP server. They do not read real auth files or call a paid model. Model inference and the exact installed Hermes version require a separate live acceptance probe.
