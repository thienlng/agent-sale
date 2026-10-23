# ADR-003: Redis + BullMQ for asynchronous processing

- Status: Proposed · Date: 2026-10-23

## Decision
BullMQ for: webhook processing, AI replies (debounced using delayed jobs + a per-conversation jobId), outbound (rate limited per page/OA group), campaigns, workflow timers, indexing, import/export. Queues are separated by priority level; workers scale with queue length.

## Options considered
Kafka (high throughput, heavy to operate), RabbitMQ, Temporal (durable workflows — reconsider for Automation Workflow if the logic becomes complex), SQS.

## Consequences
Redis becomes a critical component → HA + AOF persistence; jobs must be idempotent; the outbox pattern ensures no events are lost when the DB commits but enqueueing fails.
