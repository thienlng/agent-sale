# developer

**Purpose:** the public API's management side and outbound webhooks (ADR-022): Settings → Developers (API keys, webhook endpoints, delivery log) and the worker that turns public events into signed webhook POSTs.

**Owned tables:** `webhook_endpoints`, `webhook_deliveries` (tenant, forced RLS) and `webhook_checkpoints` (global, system role) — migration 0055, schema in `packages/db/src/schema/developer.ts`. API keys (`api_keys`, `api_idempotency_keys`) are owned by `identity`; this module serves them through `IDENTITY_API_KEYS_FACADE`.

**Public API (`api/`):** `DEVELOPER_RUNNER` → `tick()` (worker: dispatch, then send). HTTP (workspace-scoped, `developer.manage`, never callable with an API key): `/api-keys`, `/api-keys/{id}/revoke`, `/webhook-endpoints`, `/webhook-endpoints/{id}`, `/webhook-endpoints/{id}/rotate-secret`, `/webhook-endpoints/{id}/test`, `/webhook-endpoints/{id}/deliveries`, `/webhook-deliveries/{id}/resend`.

**Events consumed:** the internal sources of the public event catalog (`PUBLIC_EVENT_SOURCES` in `packages/contracts/src/developer/public-events.ts`), read from the outbox by transaction horizon (consumer `developer.webhooks`, like the analytics projector and the HQ sync). **Published:** none.

**Invariants:**

- Creating an endpoint or an API key needs the plan feature `feature.public_api` (402 `FEATURE_LOCKED`); the dispatcher also skips workspaces whose plan lost it. At most 20 endpoints per workspace.
- SSRF guard (`application/url-guard.ts`): `https` only, port 443 or ≥ 1024, no credentials, no `localhost` / `.local` / `.internal`, and every resolved address public unicast (private, loopback, link-local and metadata, CGNAT, ULA, NAT64, 6to4…). Checked at save time and again on every send; the HTTPS transport pins the socket to the vetted address (no DNS rebinding) and never follows redirects. 10 s per attempt; 2xx = success.
- Signing secrets (`whsec_…`) are sealed with SecretBox and returned only on create and rotation. After a rotation the previous secret keeps signing for 24 h: the `Rapiz-Signature` header then carries two `v1` values.
- The envelope `id` is derived from the outbox row id (`eventIdOf`), so retries, replays and resends carry the same id; `(endpoint_id, event_id)` is unique. The public payload is parsed with the catalog schema, a whitelist: internal fields never leak.
- Retries after 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h, then `failed`. A claim pushes `next_attempt_at` by a minute (`for update skip locked`), so concurrent workers never send the same delivery at once. Delivery is at least once.
- An endpoint failing for 3 days without one success is disabled (`disabledReason: failing`) and logs a warning; re-enabling (`PATCH enabled: true`) starts a fresh window. Owner notification waits for a notification module.
- Endpoint writes use the optimistic `version` (409 `STALE_VERSION`).

**Depends on:** `identity` (API keys facade) and `billing` (entitlements) facades — tier 3 (docs/ARCHITECTURE §3).

**Do not:** send to a URL without the transport (it holds the SSRF guard); log secrets or payloads; add a type to the public catalog without its whitelist schema.

**Test:** `pnpm --filter @agent-sales/backend test -- developer` · `test/public-api.integration.spec.ts`
