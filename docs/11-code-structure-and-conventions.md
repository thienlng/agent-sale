# 11 — Repo structure, API & code conventions

## 1. Proposed monorepo structure (`agent-sale-src/`)

```
agent-sale-src/
├── apps/
│   ├── web/               # Next.js — dashboard (app.<domain>)
│   ├── site/              # Next.js — marketing site + docs + blog (<domain>)
│   ├── admin/             # Next.js — internal back-office
│   ├── api/               # NestJS — REST /api/v1 + WebSocket
│   ├── webhook/           # lightweight NestJS/Fastify — receives channel, payment, carrier webhooks
│   ├── worker/            # NestJS standalone — BullMQ processors (queues selected via env WORKER_QUEUES)
│   └── widget/            # Preact — website chat widget (loader + iframe app)
├── packages/
│   ├── db/                # schema, migrations, seed, RLS policies, repository helpers
│   ├── shared/            # types, zod schemas, DTO, enums, error codes, permission keys
│   ├── ai-core/           # LLM gateway, prompts (versioned), tools, retrieval, guardrails
│   ├── channels/          # ChannelAdapter: facebook, instagram, zalo, tiktok, lazada, website, email
│   ├── carriers/          # CarrierAdapter: viettelpost, ghn, ghtk, jt, spx
│   ├── payments/          # vnpay, vietqr/bank webhook, momo
│   ├── billing/           # entitlement, quota, ledger (pure domain logic, thoroughly tested)
│   ├── ui/                # design system (shadcn-based), shared by web/admin/site
│   ├── i18n/              # messages vi/en
│   ├── config/            # eslint, tsconfig, tailwind preset
│   └── testing/           # factories, real webhook fixtures (record/replay), helpers
├── evals/                 # AI eval suites per industry (yaml/jsonl) + runner
├── infra/
│   ├── docker/            # Dockerfile per app, docker-compose.local.yml
│   ├── helm/              # charts (stage 2)
│   └── terraform/         # cloud infrastructure
├── docs/                  # this documentation
├── .github/workflows/     # CI
├── turbo.json, pnpm-workspace.yaml, package.json
└── README.md
```

Inside `apps/api/src/modules/<module>/`: `controller`, `service`, `repository`, `dto`, `events`, `policies` (permission), `*.spec.ts`. Do not import another module's repository.

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
