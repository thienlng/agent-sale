# Rule 05 — Architecture guardrails

These protect the product from eroding over hundreds of agent-written PRs. Full design: `docs/04-system-architecture.md`, `docs/05-data-model.md`, decisions: `docs/adr/`.

## Structure

The operational map is `docs/ARCHITECTURE.md` — one fixed module shape (`api/ · domain/ · application/ · infrastructure/ · interface/ · MODULE.md · __tests__/`), the allowed module graph, and the frontend feature layout. Create modules only with `pnpm gen module <name>`; copy the golden module `apps/backend/src/modules/workspace`. `pnpm arch` (dependency-cruiser), ESLint boundaries and `apps/backend/test/architecture.spec.ts` enforce it; a violation is a failing check, not a review comment.

- Monorepo: deployable apps in `apps/*`, shared code in `packages/*`. Apps may depend on packages; packages never depend on apps; packages do not import each other in cycles (`dependency-cruiser`/ESLint boundaries enforce this when configured).
- Backend is a **modular monolith** (NestJS). Each domain module (`identity`, `workspace`, `billing`, `bot`, `knowledge`, `channel`, `conversation`, `ai`, `crm`, `commerce`, `shipping`, `marketing`, `automation`, `analytics`, `notification`, `support`, `affiliate`, `audit`) owns its tables and repositories. **Cross-module access goes through the other module's service interface or a domain event — never through its repository or tables.**
- Four runtime processes share the codebase: `api` (HTTP + WebSocket), `webhook` (verify + persist + enqueue only; no business logic), `agent` (AI conversation runtime consuming the `conversation` queue; the only process that calls LLMs, via `packages/ai-core`), `worker` (BullMQ processors for outbound, campaign, workflow, indexer). Do not put slow work in `api`/`webhook` request paths; do not put CPU-heavy work (PDF parsing, OCR, local embeddings) in `agent`.
- `hermes-runtime` (`services/hermes`, ADR-010) is an optional inference sidecar, not a fifth platform process: it is reached only through `packages/ai-core`'s `HermesProvider`, never touches the database, Redis, storage or channels, and holds no business logic. Anything tenant-, bot- or conversation-aware stays in NestJS. See `docs/ARCHITECTURE.md` §7.
- New third-party integrations implement the existing adapter interfaces (`packages/channels`, `packages/carriers`, `packages/payments`). No provider SDK calls outside its adapter.
- LLM calls only through `packages/ai-core` (gateway). Prompts live in `packages/ai-core/prompts/<name>@<version>.md` and are versioned; changing a prompt requires running the evals.

## Data

- Every business table has `workspace_id`; every query is scoped by it; Postgres RLS stays enabled. A query without workspace scoping is a bug, not a style issue.
- IDs are UUIDv7. Money/credits are integers. Timestamps are `timestamptz` in UTC.
- **Ledger rule:** wallet balances change only together with a `ledger_entries` row with a unique `idempotency_key`, in the same transaction. No direct balance updates.
- **Idempotency:** webhook events, outbound sends, order creation, shipment creation and payments are idempotent by business key. Retries must be safe.
- Migrations: versioned, forward-only, backward compatible with the currently deployed code (expand → migrate → contract). No destructive migration without an explicit task + ADR note. Large-table changes are batched.
- Snapshot what must not change later (order item name/price/SKU).

## Compatibility

- Public API (`/api/v1`) is additive. Removing or renaming a field, route, enum value, event name or env var is a breaking change: it needs a deprecation period, a `BREAKING CHANGE:` footer, and an entry in `docs/`.
- Domain events and queue job payloads are contracts: version them; consumers must tolerate unknown fields.
- Feature flags for anything not ready for all tenants.

## When to write an ADR

Write/update an ADR (`docs/adr/`, template `ADR-000-template.md`) when you: add or replace a core technology, change module boundaries, change the tenant model, change how money/credits flow, add a new runtime process, or deviate from an existing ADR. An ADR is a required part of such a PR; the PR cannot merge without it. If you are an agent and the task does not clearly authorize an architectural change, stop and ask.
