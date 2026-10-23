# @agent-sales/webhook

Thin Fastify ingress for channel, payment and carrier webhooks (ADR-009, docs/04 §6): verify signature → store raw event once (dedup by `(kind, externalEventId)`) → enqueue → `200` within the budget (p95 ≤ 200 ms). **No business logic, no NestJS.** Processing happens in `apps/backend` workers.

`buildServer(deps)` takes ports (`IngressStore`, `IngressQueue`, `ChannelRegistry`) so tests run with in-memory adapters via `app.inject`.
