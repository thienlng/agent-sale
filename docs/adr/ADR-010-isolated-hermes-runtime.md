# ADR-010: Isolate the inherited Hermes AI runtime behind a private bridge

- Status: Accepted (owner, 2026-10-24, merging PR #40)
- Date: 2026-10-24
- Decision makers: thienlng (maintainer); implementation requested by the owner

## Context

T-045 requires bot training and Facebook/Instagram chat within a short delivery window. The owner explicitly chose to retain the existing Python/Hermes core from booking-agent and postpone a TypeScript conversion. The platform remains a TypeScript/NestJS modular monolith; its existing tenant, retrieval, grounding and delivery invariants must continue to hold.

## Decision

Add a private Python/Hermes runtime service, named **`hermes-runtime`** (`services/hermes`), with a versioned, bearer-authenticated, bounded HTTP contract and a provider adapter in packages/ai-core. Select Hermes explicitly through the existing encrypted platform LLM configuration and tier routes. NestJS remains authoritative for workspace authorization, bot knowledge, conversation history, human control and outbound delivery. Hermes receives only explicit context and has no platform database, shell or outbound tools. No other project credentials are copied, and no paid-provider fallback is implicit.

The initial Meta agent worker consumes a durable PostgreSQL ingress queue with leases and idempotent receipts. This bounded first slice avoids a non-transactional persist/enqueue gap while the shared BullMQ dispatch infrastructure is incomplete; its public facade remains independent of transport. This is a temporary queue adapter choice, not a reversal of the platform BullMQ target.

## Options considered

1. Port the full Hermes runtime to TypeScript: rejected for this milestone because it increases compatibility and OAuth regression risk before inbox delivery is verified.
2. Import the whole booking service and its database/tools: rejected because booking-specific identities, tools and delivery are not appropriate for this multi-tenant sales platform.
3. Keep Hermes behind a small replacement port: selected, preserving reusable orchestration and allowing a future TypeScript adapter without frontend or inbox API changes.

## Consequences

The platform temporarily deploys a Python service in addition to its documented NestJS entries. Runtime credentials and resource limits need separate supervision. Missing auth/provider capacity is an explicit error, and live subscription access remains subject to provider eligibility and quota. Automated tests cover the boundary without real customer data or external model calls. The inherited runtime currently runs without model tools; future catalog/action tools require reviewed server-bound contracts. The exact setup and limitations are in services/hermes/README.md.
