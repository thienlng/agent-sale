# @agent-sales/webhook

Thin Fastify ingress for channel, payment and carrier webhooks (ADR-009, docs/04 §6): verify signature → store raw event once (dedup by `(kind, externalEventId)`) → enqueue → `200` within the budget (p95 ≤ 200 ms). **No business logic, no NestJS.** Processing happens in `apps/backend` workers.

`buildServer(deps)` takes ports (`IngressStore`, `IngressQueue`, `ChannelRegistry`) so tests run with in-memory adapters via `app.inject`.

`POST /webhooks/kiotviet/:token` (KiotViet, spec 2026-11-01 §4.6): the path token picks the connection (malformed, unknown or disconnected → `410`); the raw body (≤ 1 MiB, any content type, even malformed JSON) and `X-Hub-Signature` go to `integration_webhook_events` once per delivery `Id` (missing → body sha256) → `200 { ok: true }`. The backend worker verifies the signature. The token and the body never reach a log line (request URLs are redacted, not-found and error logs carry only the redacted URL or the error class and Postgres code). A body Postgres cannot store as text (e.g. with a NUL byte) answers `500`, so KiotViet retries.
