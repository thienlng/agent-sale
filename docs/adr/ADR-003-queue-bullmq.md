# ADR-003: Redis + BullMQ for asynchronous processing

- Status: Proposed · Date: 2026-10-23

## Decision
BullMQ for: webhook processing, AI replies (debounced using delayed jobs + a per-conversation jobId), outbound (rate limited per page/OA group), campaigns, workflow timers, indexing, import/export. Queues are separated by priority level; workers scale with queue length.

## Options considered
Kafka (high throughput, heavy to operate), RabbitMQ, Temporal (durable workflows — reconsider for Automation Workflow if the logic becomes complex), SQS.

Clarification after review (2026-10-23): open-source BullMQ has **no per-group (per-tenant) concurrency or rate limiting** — those are BullMQ Pro features. Tenant fairness is therefore implemented by us (`packages/queue`): a Redis token bucket per `workspace_id` (and per `channel_connection_id` for sends) checked at job start, jobs over budget are re-delayed with jitter, and separate queues per tenant tier (`conversation:std`, `conversation:priority`) with weighted workers. Decision gate at Beta: if the fairness layer or multi-day workflows (follow-up sequences) become hard to reason about, evaluate Trigger.dev (self-hostable, `concurrencyKey` per tenant) or Temporal (fairness keys) for the workflow/agent queues; BullMQ Pro is the cheapest fallback for fairness alone.

## Consequences
Redis becomes a critical component → HA + AOF persistence; jobs must be idempotent; the outbox pattern ensures no events are lost when the DB commits but enqueueing fails.
