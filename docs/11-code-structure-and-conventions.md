# 11 — Repo structure, API & code conventions

## 1. Proposed monorepo structure (`agent-sale-src/`)

```
agent-sale-src/
├── apps/
│   ├── backend/           # NestJS 12 on Fastify — modular monolith; src/entries/{api,worker,agent,realtime}.ts; src/modules/<name>/
│   ├── webhook/           # thin Fastify app (no NestJS) — verify, persist, enqueue channel/payment/carrier webhooks
│   ├── web/               # Vite + React SPA — dashboard (app.<domain>), served from CDN; src/features/<module>
│   ├── admin/             # (later) Vite + React SPA — internal back-office
│   ├── site/              # (later) Astro — marketing site + docs + blog (<domain>)
│   ├── widget/            # (later) Preact — website chat widget (loader + iframe app)
│   └── mobile/            # (later) React Native + Expo — inbox, handoff, CRM, notifications
├── packages/
│   ├── shared/            # shared kernel: ids (branded), Result/DomainError, DomainEvent/AggregateRoot, money, phone
│   ├── contracts/         # Zod schemas + types for DTOs and integration events, per module (the only backend thing web imports)
│   ├── db/                # Drizzle schema per module, SQL migrations, withTenant()/withSystem(), roles
│   ├── queue/             # queue catalogue, TenantJob, jobId(), tenant fairness token buckets
│   ├── ai-core/           # LLM gateway, providers (fake for tests), prompt registry (prompts/<name>@<v>.md)
│   ├── channels/          # ChannelAdapter contract + registry; one adapter per platform
│   ├── ui/                # design tokens + primitives (shadcn-style)
│   ├── i18n/              # message catalogs vi/en
│   └── testing/           # factories, tenant helpers, cross-tenant assertions (test-only)
├── turbo/generators/      # `pnpm gen module|feature` templates
├── evals/                 # (T-007) AI eval cases + runner
├── infra/                 # docker compose, Dockerfiles, Ansible/Terraform, Helm (later)
├── docs/                  # design docs, ARCHITECTURE.md, ADRs, reference
├── .dependency-cruiser.cjs, eslint.config.js, turbo.json, pnpm-workspace.yaml, package.json
└── README.md
```

Inside `apps/backend/src/modules/<name>/`: the fixed shape from `docs/ARCHITECTURE.md` §2 (`api/`, `domain/`, `application/`, `infrastructure/`, `interface/`, `MODULE.md`, `__tests__/`). Other modules import only `api/`.

## 2. API conventions

- REST JSON, prefix `/api/v1`, plural resources, kebab-case: `/api/v1/bots/{id}/knowledge-items`.
- Headers: `Authorization: Bearer <access>`, `X-Workspace-Id: <uuid>` (server verifies membership), `Idempotency-Key` for POSTs that create orders/payments/messages/campaigns.
- Pagination: cursor (`?cursor=&limit=`) for large lists (messages, contacts, orders); offset for small configuration tables. Response `{ data, page: { nextCursor, total? } }`.
- Filtering: `?filter[status]=new&filter[createdAt][gte]=...`; sorting `?sort=-createdAt`.
- Standard errors (RFC 7807-like):
  ```json
  { "error": { "code": "QUOTA_EXCEEDED", "message": "Bạn đã dùng hết 5.000 khách CRM của gói Miễn phí", "details": {"key":"contacts.max","limit":5000}, "traceId": "..." } }
  ```
  Error codes are defined centrally in `packages/shared/errors.ts`; the FE maps codes → UI (e.g. `FEATURE_LOCKED` → `<UpgradeGate/>`).
- OpenAPI is generated automatically from NestJS (Swagger) → generates a TypeScript client for the FE (orval/openapi-typescript). The public API (P2) shares the same spec, with separate scopes.
- Outbound webhooks for customers (P2): HMAC-SHA256 signed, progressive retry for 24h, delivery log.
- WebSocket events are named `domain.action` (`message.new`).

## 3. Code conventions

- TypeScript `strict`; ESLint + Prettier; no `any` except at external boundaries (raw webhooks), and it must be parsed with Zod immediately.
- Validate all input at the boundary (DTO/Zod); pure domain logic (billing, order formulas, state machines) has no framework dependency → easy unit testing.
- Money/credit: only use `bigint`/integer helpers; floats are forbidden for money (lint rule).
- Time: store in UTC (`timestamptz`), display in the workspace timezone; use `date-fns-tz`.
- Every BullMQ job: deterministic `jobId` (idempotent), small payload (IDs, never large data), with `attempts` + backoff, handle `UnrecoverableError` for non-retryable errors.
- Commit names: Conventional Commits (`feat(inbox): ...`); automatic changelog.
- Prompts: files in `packages/ai-core/prompts/<name>@<version>.md`, reviewed like code; changing a prompt = bumping the version + running evals.
- i18n: no hard-coded UI strings; keys per module.
- Never commit secrets; keep `.env.example` complete.

## 4. Definition of Done (per story)

1. Code + tests (unit for logic, integration for API/DB, e2e for main flows if a P0 flow is touched).
2. Permission & tenant checks (cross-tenant tests for new endpoints).
3. Audit log written for sensitive operations; metrics/logs include `workspace_id`.
4. i18n vi/en; empty/loading/error states; responsive per the NFRs.
5. Backward-compatible migrations; seed updated if needed.
6. Docs: update `docs/` if behavior/architecture changes; ADR for major decisions.
7. Review approved, CI green, deployed to staging, and accepted by the PO.

## 5. Getting started (once scaffolded)

```bash
pnpm i
docker compose -f infra/docker/docker-compose.local.yml up -d   # postgres(pgvector), redis, minio, mailpit, langfuse
pnpm db:migrate && pnpm db:seed
pnpm dev            # turbo runs web, api, webhook, worker, widget
```
