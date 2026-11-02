# Public API and webhooks (VRT-10)

A workspace connects its own systems (ERP, POS, PMS, n8n/Make/Zapier, a custom CRM) to Rapiz with API keys
and signed webhooks ([ADR-022](../adr/ADR-022-public-api-and-webhooks.md)). Code: API keys, the guard, the
rate limit and idempotency in `apps/backend/src/modules/identity`; webhooks and the Settings → Developers
HTTP surface in `apps/backend/src/modules/developer` (see its `MODULE.md`); contracts in
`packages/contracts/src/developer`.

## Plan

`feature.public_api` (flag) and `api.requests_per_minute` (limit). Pro and Neo: on, 120/min; Free and
Smart: off (402 `FEATURE_LOCKED`). Operators grant overrides in `/admin`. The gate is cached 60 s per
workspace.

## API keys

- Created in Settings → Developers by members with `developer.manage` (owner, admin):
  `POST /api-keys { name, scopes, expiresAt? }`. The answer carries the full key **once**
  (`rpz_live_<id>_<secret>`); only the SHA-256 of the secret is stored. `GET /api-keys`,
  `POST /api-keys/:id/revoke`.
- Calls: `Authorization: Bearer rpz_live_…`. The workspace comes from the key; `X-Workspace-Id` is
  optional and answers 404 when it names another workspace.
- Only routes whose contract says `apiKey: true` accept a key; every other route answers 404. The list is
  `GET /api/v1/public/openapi.json` (no auth), with the `ApiKey` security scheme.
- A request runs as the key's creator with `scopes ∩ creator's role`. When the creator leaves the workspace
  the key answers 401. Audit rows name the actor `API: <key name>`. `last_used_at` is written at most once
  a minute.
- Errors: 401 unknown, revoked or expired key; 402 plan; 403 capability outside the scopes; 404 route not
  public or wrong workspace; 429 rate limit.

### Rate limit

Fixed 60 s window per key. Every answer carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
`X-RateLimit-Reset`; a 429 adds `Retry-After` (seconds).

**Deviation from ADR-022 §4:** the counter is in process memory behind a port (same as webchat), not
Redis, so with N API instances a key gets up to N × the limit. Moving it to Redis is one adapter.

### Idempotency

Write routes (POST, PATCH, PUT, DELETE) called with a key accept `Idempotency-Key` (≤ 255 chars). The
first 2xx answer is stored for 24 h per key and replayed with `Idempotent-Replayed: true`. The same key
with another method, path or body: 422 (`details.reason: idempotency_key_reused`); while the first request is
running: 409 (`idempotency_in_flight`). A failed request releases the key. Session (dashboard) calls ignore the header.

## Webhooks

Settings → Developers → Webhooks (`developer.manage`):

| Route | |
|---|---|
| `GET/POST /webhook-endpoints`, `PATCH/DELETE /webhook-endpoints/:id` | At most 20 per workspace. Create answers the `whsec_…` secret once. `PATCH` takes `version` (409 on a stale one); `enabled: true` re-enables a disabled endpoint |
| `POST /webhook-endpoints/:id/rotate-secret` | New secret; the old one keeps signing for 24 h |
| `POST /webhook-endpoints/:id/test` | Queues a `webhook.test` delivery (202) |
| `GET /webhook-endpoints/:id/deliveries?status&cursor&limit` | Delivery log, newest first |
| `POST /webhook-deliveries/:id/resend` | Requeues one delivery with the same event id (202) |

### Delivery

- Events: only `PUBLIC_EVENT_TYPES` (`packages/contracts/src/developer/public-events.ts`), mapped to a
  stable `data` payload; an endpoint receives the types it subscribed to.
- POST body `{ id, type, workspaceId, occurredAt, data }`; headers `Rapiz-Event-Id`, `Rapiz-Event-Type`,
  `Rapiz-Signature: t=<unix>,v1=<hex>` where `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`. During a
  rotation the header carries two `v1` values (new and old secret). Receivers should accept any matching
  `v1`, reject a `t` older than 5 minutes, and dedupe by `Rapiz-Event-Id` (delivery is at least once).
- 10 s timeout, no redirects; only 2xx counts as delivered. Retries after 1 m, 5 m, 30 m, 2 h, 6 h, 12 h,
  24 h; after the 8th failed attempt the delivery is `failed` (resend restarts it).
- An endpoint without one success for 3 days is disabled (`disabledReason: failing`) and logged.
- SSRF guard, at save time and before every send (DNS rebinding): `https` only, port 443 or ≥ 1024, no
  credentials in the URL, and no address in loopback, private, link-local, CGNAT, multicast, reserved or
  cloud-metadata ranges (IPv4 and IPv6). The connection is pinned to the vetted address.

### Worker

`apps/backend/src/entries/worker.ts` ticks `DEVELOPER_RUNNER` every 2 s: the dispatcher reads
`outbox_events` by transaction horizon (checkpoint `webhook_checkpoints`, consumer `developer.webhooks`,
advisory lock so one worker dispatches) and inserts one delivery per endpoint and event (unique on
`(endpoint_id, event_id)`); the sender claims up to 100 due deliveries with `FOR UPDATE SKIP LOCKED` and a
60 s lease, posts them in order per endpoint, endpoints in parallel.

## Not yet

- Owner notification when an endpoint is disabled (logged only; there is no notification module yet).
- Redis rate limiter (see above).
- Audit events for webhook endpoint changes.
- OAuth apps (ADR-022 option 2).
