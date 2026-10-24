# ADR-010: Isolate the inherited Hermes AI runtime behind a private bridge

- Status: Accepted (owner, 2026-10-24, merging PR #40)
- Date: 2026-10-24
- Decision makers: thienlng (maintainer); implementation requested by the owner

## Context

T-045 requires bot training and Facebook/Instagram chat within a short delivery window. The owner explicitly chose to retain the existing Python/Hermes core from booking-agent and postpone a TypeScript conversion. The platform remains a TypeScript/NestJS modular monolith; its existing tenant, retrieval, grounding and delivery invariants must continue to hold.

## Decision

Add a private Python/Hermes runtime service, named **`hermes-runtime`** (`services/hermes`), with a versioned, bearer-authenticated, bounded HTTP contract and a provider adapter in packages/ai-core. Select Hermes explicitly through the existing encrypted platform LLM configuration and tier routes. NestJS remains authoritative for workspace authorization, bot knowledge, conversation history, human control and outbound delivery. Hermes receives only explicit context and has no platform database, shell or outbound tools. No other project credentials are copied, and no paid-provider fallback is implicit.

The initial Meta agent worker consumes a durable PostgreSQL ingress queue with leases and idempotent receipts. This bounded first slice avoids a non-transactional persist/enqueue gap while the shared BullMQ dispatch infrastructure is incomplete; its public facade remains independent of transport. This is a temporary queue adapter choice, not a reversal of the platform BullMQ target.

### Amendment (T-052): admin ChatGPT sign-in, model list, shared auth lock

- **Bridge endpoints** beyond `POST /v1/generate` (all bearer-authenticated, never returning tokens): `GET /v1/models` (model ids the signed-in plan can use), `GET /v1/auth/status`, `POST /v1/auth/start`, `POST /v1/auth/logout`. The two auth POSTs reject any request body (400).
- **Callers in `packages/ai-core`:** `HermesProvider` (generate), `HermesLoginClient` (`/v1/auth/*`) and `listProviderModels` (`/v1/models`). All validate the bridge URL through one helper (`parseBridgeBaseUrl`). NestJS reaches them only through `LlmAdminService` (platform-admin routes `/admin/llm/providers/{id}/hermes-login` and `/models`); no other module or app calls the bridge.
- **`auth.json` ownership:** the bridge process alone reads and writes `<HERMES_HOME>/auth.json`. Sign-in completion (`login.py`), logout and the runtime's token refresh (`runtime.py`) all go through `services/hermes/authstore.py`, which takes one inter-process `flock` on `<HERMES_HOME>/.auth.lock` (mode 600) around every read-modify-write. The lock is never held during network I/O: a refresh reads under the lock, calls OpenAI outside it, then re-locks and writes only if the stored refresh token is still the one it used. A logout or new sign-in in the meantime wins and the turn fails with `MODEL_AUTH_REQUIRED`.
- **Logout is local only.** Hermes uses no documented OpenAI token-revocation endpoint, so logout deletes `auth.json` and does not revoke the refresh token at OpenAI; the UI says so.
- **Production gate:** the subscription sign-in is controlled by `HERMES_SUBSCRIPTION_LOGIN` (backend env). Default: on outside production, off in production unless set to `true`. When off, `GET .../hermes-login` returns `{state:"disabled"}` and `POST`/`DELETE` return 403 `FORBIDDEN`. Whether a ChatGPT plan may back a hosted product is an open owner decision (B3); the gate stays until it is recorded here.

## Options considered

1. Port the full Hermes runtime to TypeScript: rejected for this milestone because it increases compatibility and OAuth regression risk before inbox delivery is verified.
2. Import the whole booking service and its database/tools: rejected because booking-specific identities, tools and delivery are not appropriate for this multi-tenant sales platform.
3. Keep Hermes behind a small replacement port: selected, preserving reusable orchestration and allowing a future TypeScript adapter without frontend or inbox API changes.

## Consequences

The platform temporarily deploys a Python service in addition to its documented NestJS entries. Runtime credentials and resource limits need separate supervision. Missing auth/provider capacity is an explicit error, and live subscription access remains subject to provider eligibility and quota. Automated tests cover the boundary without real customer data or external model calls. The inherited runtime currently runs without model tools; future catalog/action tools require reviewed server-bound contracts. The exact setup and limitations are in services/hermes/README.md.
