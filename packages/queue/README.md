# @agent-sales/queue

Thin layer over BullMQ: queue catalogue (`QUEUES`), tenant job envelope, deterministic job ids (idempotent enqueue), and the **tenant fairness** token buckets that open-source BullMQ lacks (ADR-003). Processors live in modules (`application/jobs`), not here.

- `TenantFairness.admit()` returns `0` (run) or a delay in ms (re-enqueue with `moveToDelayed`), per workspace tier and per channel.
- `InMemoryBucketStore` is for tests; the Redis store (atomic Lua) is added with the first worker task.
- Every job payload is a `TenantJob` and runs inside `withTenant()`.
