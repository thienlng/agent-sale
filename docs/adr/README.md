# Architecture Decision Records

Each ADR: Context → Decision → Consequences. Status: `Proposed` → `Accepted` / `Superseded by ADR-xxx`. Add a new ADR by copying `ADR-000-template.md`.

| ADR | Topic | Status |
|---|---|---|
| [001](ADR-001-typescript-nestjs-modular-monolith.md) | TypeScript + NestJS modular monolith, monorepo | Proposed |
| [002](ADR-002-postgresql.md) | PostgreSQL + pgvector instead of MongoDB | Proposed |
| [003](ADR-003-queue-bullmq.md) | Redis + BullMQ for asynchronous processing | Proposed |
| [004](ADR-004-multi-tenant-rls.md) | Multi-tenant shared schema + RLS | Proposed |
| [005](ADR-005-llm-gateway.md) | Multi-provider LLM Gateway, commercial tiers | Proposed |
| [006](ADR-006-hosting-region.md) | Hosting model (self-hosted only — decided) & data region (open) | Partially decided |
| [007](ADR-007-auth.md) | Build auth in-house | Proposed |
| [008](ADR-008-credit-ledger.md) | Immutable ledger, milli-credit unit | Proposed |
| [009](ADR-009-tech-stack-for-speed-and-scale.md) | Stack for perceived speed and ~1,000-tenant scale: Vite SPA + Astro + NestJS/Fastify; supersedes the Next.js dashboard choice | Proposed |
| [010](ADR-010-isolated-hermes-runtime.md) | Isolated `hermes-runtime` and first Meta ingress queue adapter | Accepted |
| [011](ADR-011-website-widget-shadow-dom-and-polling.md) | Website chat widget: single Shadow DOM script, ES2017, polling first, HMAC visitor token | Accepted |
| [012](ADR-012-accounts-own-businesses-bot-is-selling-unit.md) | Accounts own businesses (billing and portfolio); the bot is the selling unit, no shop entity | Proposed |
| [013](ADR-013-lodging-catalog-and-stay-requests.md) | Whole-property accommodation metadata and staff-confirmed stay requests inside commerce | Proposed |
| [014](ADR-014-saas-vertical-requests-subscriptions-builtin-tool.md) | SaaS vertical: `saas` module with demo/trial requests and customer subscriptions; built-in bot tool for requests | Proposed |
