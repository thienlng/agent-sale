# ADR-009: Tech stack for perceived speed and scale to ~1,000 tenants

- Status: Proposed (supersedes the "Next.js for the dashboard" choice in ADR-001 §Decision and `docs/04` §4; everything else in ADR-001…008 stands)
- Date: 2026-10-23
- Deciders: `thienlng`, `tungdd7`

## Context

Product requirements from the owner: the web app must *feel* fast, smooth and modern in every interaction (inbox, CRM tables, order forms), the backend must be fast, and the architecture must scale to roughly 1,000 integrated businesses without a rewrite. Most code will be written by coding agents, so the stack must also be one agents know deeply and one that enforces structure.

"Feels fast" is mostly a frontend property: instant navigation, no full-page reloads, optimistic updates, cached data, virtualized lists, realtime push, skeletons instead of spinners, sub-300 KB initial JavaScript. Backend speed matters for list endpoints and realtime fan-out; the slowest parts (LLM calls, Meta/Zalo APIs) are external and handled asynchronously regardless of language.

Load envelope at 1,000 tenants (estimate, see `docs/16-performance-and-scale.md`): ~1.5–3 M inbound messages/day (20–35/s average, bursts to ~1,000/s during ad campaigns), ~5,000 connected channels, ~3,000 concurrent dashboard users at peak. This is comfortably within a horizontally scaled Node.js + PostgreSQL system; the bottlenecks are database design, queueing and third-party rate limits, not CPU.

## Decision

| Layer | Choice | Why (speed / scale / agents) |
|---|---|---|
| Dashboard `apps/web` | **Vite + React 19 + TypeScript SPA** with **TanStack Router** (type-safe routes, hover/intent preloading), **TanStack Query** (cache, optimistic mutations), **TanStack Table + Virtual**, **Tailwind CSS v4 + shadcn/ui** (Radix primitives), `motion` for purposeful animation, `cmdk` command palette, `react-hook-form` + Zod, `i18next`, Socket.IO client. Served as static files from a CDN. | Client-side navigation is instant; no server render in the request path; smallest mental model for agents; largest React ecosystem. A static SPA is also the cheapest thing to scale (CDN). |
| Marketing site `apps/site` | **Astro** (static output, islands) with the same Tailwind tokens; content collections for industry pages, docs and blog. | Fastest possible public pages for SEO in Vietnam; no server needed; separates marketing from the app. |
| Chat widget `apps/widget` | **Preact + Vite (lib mode)**: ≤ 15 KB loader, iframe app. | Must not slow down customers' websites. |
| Back-office `apps/admin` | Same stack as `apps/web` (separate build, internal auth). | Reuse `packages/ui`. |
| API `apps/api` | **NestJS 11 on Fastify**, Node 24, Zod DTOs (`nestjs-zod`), Pino logs, OpenAPI generated from code → typed client for the SPA via `openapi-typescript` + `openapi-fetch`. | Fastify is among the fastest Node HTTP stacks; NestJS modules/guards/DI give agents a fixed structure (Rule 05). Typed client without a runtime (no tRPC coupling, public API stays possible). |
| Webhook ingress `apps/webhook` | Thin Fastify app (no Nest), verify → persist → enqueue, p99 < 200 ms. | Isolated from API deploys and load. |
| Workers `apps/worker` | NestJS standalone app, BullMQ processors, one deployment per queue group. | Independent autoscaling by queue depth. |
| Realtime | **SSE** for server→client (inbox updates, widget streaming) fed by Redis pub/sub, resumable via `Last-Event-ID`; websocket-only Socket.IO (Redis adapter, no sticky sessions) only for typing/presence; separate `realtime` deployment with long termination grace; 30 s heartbeat (below Cloudflare's idle cut-off). | Stateless, survives rolling deploys (no reconnect storms from API rollouts), no stickiness required. |
| Database | **PostgreSQL 16+** with pgvector, pg_trgm, unaccent; **Drizzle ORM** + `postgres.js` driver; **PgBouncer** (transaction pooling); read replica for analytics; monthly partitions for high-volume tables; RLS. | Per ADR-002/004. Drizzle generates plain SQL (fast, predictable, inspectable by reviewers). |
| Cache / queue | Redis 7 (BullMQ, cache, rate limit, locks, Socket.IO adapter). | Per ADR-003. |
| Storage | S3-compatible object storage behind a CDN with signed URLs. | Media never passes through the API. |
| AI | `packages/ai-core` gateway (ADR-005), streaming where the UI can show it. | — |
| Edge / hosting | Cloudflare (CDN, WAF, DNS) in front; compute in Singapore (or Vietnam, per ADR-006); Docker now, Kubernetes with HPA/KEDA at scale. | ~30–40 ms RTT from Vietnam; static assets at the edge. |

### The AI agent runtime is its own process (TypeScript)

The conversation agent (orchestrator, LLM calls, retrieval, tools, guardrails) runs as a **separate deployable `apps/agent`** (NestJS standalone consuming the `conversation` queue) built on `packages/ai-core`. Reasons: failure isolation (slow/failed LLM providers never slow the API), independent scaling on queue depth, a hard boundary that lint can enforce ("LLM calls only via `ai-core`, domain access only via service interfaces"), and a cheap exit if the runtime ever needs another language — only one queue consumer changes.

Why TypeScript and not Go/Python for it: the workload is almost entirely I/O-bound (waiting on LLM APIs, DB, vector search) where Node's concurrency is ideal and Go's CPU/memory advantages are irrelevant at our scale; tool definitions reuse the same Zod schemas as the domain API, so tools cannot drift from the product; the TS AI ecosystem (provider SDKs with tool calling/streaming, Vercel AI SDK) is strong. Python is adopted only for ML-heavy components (custom reranker, local embeddings, fine-tuned classifiers) and then as **separate inference servers** (TEI/vLLM-style, HTTP) behind the `ai-core` retrieval/gateway interfaces — the runtime does not change. CPU-heavy work (PDF parsing, OCR, local embedding) never runs inside the reply loop; it belongs to the `indexer` worker. Long multi-day flows (follow-up sequences) start on BullMQ delayed jobs; Temporal is the upgrade path if durable execution becomes complex.

### Mobile readiness

The dashboard is one client of an API-first backend; a mobile app is a second client, not a new backend. Planned path: PWA (manifest, service worker, Web Push) during beta → **React Native + Expo** (`apps/mobile`) for inbox, handoff, quick CRM and notifications, sharing `packages/shared` (schemas, error codes), the generated OpenAPI client, TanStack Query hooks and Tailwind design tokens (NativeWind); Socket.IO client for realtime; FCM/APNs via the `notification` module with a `device_tokens` table. Constraints kept from the first API task so mobile is never blocked: bearer tokens (no cookie-only auth), explicit CORS, versioned API with cursor pagination and `fields` selection, canonical deep links (`/app/inbox/{id}`), rate limits per user/device.

## Alternatives considered

| Alternative | Why not (now) |
|---|---|
| Next.js App Router for the dashboard (previous choice) | Server components and SSR add latency and complexity to an authenticated app that needs no SEO; navigation and dev loops are heavier; agents produce more inconsistent code across server/client boundaries. Keep Next.js knowledge for later if a server-rendered surface appears. |
| Next.js for the marketing site | Works, but Astro produces lighter static pages with less machinery; the site has no app logic. |
| Go (Fiber/Chi) for API/ingress/workers | 3–10× lower CPU/memory, but splits the codebase (no shared types with the SPA), halves agent productivity, and the measured bottlenecks are not CPU. Revisit for `webhook`/`worker` only if profiling at scale shows Node as the limit. |
| Bun runtime | Faster startup/install, but NestJS, `postgres.js` and BullMQ compatibility is still less proven in production; keep Node 24 and re-evaluate yearly. |
| Hono/Fastify without NestJS | Faster to start, but no enforced module structure — agent-written code drifts. NestJS-on-Fastify keeps most of the speed with the structure. |
| tRPC | Excellent DX, but couples FE to a TS-only RPC and complicates the public API. OpenAPI codegen gives the same type safety. |
| SolidJS / Svelte | Faster runtime, smaller bundles, but much smaller ecosystem and weaker agent familiarity; UI libraries lag. |
| MongoDB (Preny's choice) | Rejected in ADR-002. |

## Revisions after independent review (2026-10-23)

An adversarial review (17 findings) and a best-practice survey (Oct 2026 sources) were run before accepting this ADR. Decisions changed or sharpened as a result — each is recorded in the owning document:

| Finding | Decision | Where |
|---|---|---|
| `SET app.workspace_id` leaks tenants behind PgBouncer transaction pooling (blocker) | Transaction-scoped `set_config(..., true)` only, via a mandatory `withTenant()`; InitPlan policies with `nullif`; forced RLS; two roles `app_tenant`/`app_system`; PgBouncer ≥ 1.21 or `prepare: false`; CI isolation test | ADR-004, docs/05 §9 |
| Monthly partitioning makes `idempotency_key UNIQUE` impossible (blocker) | No partitioning at first; `ledger_entries` never partitioned; dedup keys in unpartitioned key tables / Redis NX when partitioning is introduced; no FKs across partitioned tables; `drizzle-kit push` banned | ADR-008, docs/05 §9 |
| Per-tenant fairness relied on BullMQ Pro-only groups | Own fairness layer (`packages/queue`): Redis token buckets per workspace/channel, tier queues; decision gate at Beta for Trigger.dev/Temporal | ADR-003, docs/16 §3, docs/17 §6 |
| 1,000 msg/s burst ≈ 36k LLM RPM exceeds provider tiers; 8 s p95 cannot hold | Burst SLO rewritten as degradation (ack ≤ 1 s + holding message, tier priority, minutes not seconds); LLM admission controller with per-provider token buckets, prompt-cache strategy, negotiated limits before GA; debit outside the LLM call | docs/16 §2b, §3 |
| "Workspace→DB router from the first migration" was not buildable as stated | Downgraded to a `tenant_routes` table + single `withTenant()` path now; multi-DB runner only when the first dedicated-DB tenant exists (future ADR) | docs/17 §6, docs/05 §8b |
| SPA refresh-token storage unspecified (agents would use `localStorage`) | Access token in memory; refresh token in HttpOnly cookie scoped to `/auth/refresh`; native clients via body; `/bootstrap` endpoint; strict CSP | docs/09 |
| Socket.IO inside `api` → reconnect storms on every deploy; stickiness | SSE-first realtime, separate `realtime` deployment, websocket-only Socket.IO for presence | this ADR, docs/04 |
| pgvector hash partitions + HNSW lose recall for small bots; fixed `VECTOR(1536)` | Exact scan by default, partial HNSW for large bots, per-model embedding storage | docs/17 §6, docs/06 §4 |
| Observability stack too large for two operators | Managed Grafana Cloud + Langfuse Cloud (sampled) until GA; four deployables; KEDA `redis-lists` scaler | docs/04, docs/10 |
| Streaming/prompt caching/provider pooling named but undesigned | Streaming only for the widget (SSE); pooling = admission controller; single primary provider per tier, failover = degraded-cost mode; promptfoo + Langfuse as the eval/trace pair | docs/16 §2b, docs/06 |
| First-load claims overstated; budget arithmetic tight | Budgets aligned to Core Web Vitals (LCP ≤ 2.5 s, INP ≤ 200 ms); lazy-load `motion`/charts/i18n; SSE/`ws` instead of `socket.io-client` in the shell; table budget rewritten | docs/16 §1 |
| Contradictions (webhook framework, ack budgets, ORM, process list) | Webhook = thin Fastify; ack p95 ≤ 200 / p99 ≤ 500 ms everywhere; Drizzle + Zod only; processes `api`/`webhook`/`agent`/`worker`/`realtime` | docs/04, docs/10, docs/11 |
| NestJS vs Fastify-only for agent-written code (best-practice survey leans Fastify + explicit modules) | NestJS on Fastify **kept** for its enforced module/guard structure and OpenAPI generation, with rules that limit framework magic (no request-scoped providers, no circular modules, thin handlers, framework-free domain services). Exit criterion: if T-003 shows DI/decorator friction with `withTenant()`/RLS, switch to Fastify + explicit modules + ts-rest/oRPC before any domain module is written | docs/04 |

Still open (cheap, tracked as tasks): feature-flag evaluation semantics (kill switch, per-workspace beta), `/api/v1` deprecation policy for the public API, local-dev secrets story, per-tenant AI spend cap in `ai-core` (now in docs/16 §2b), RLS performance spike on a 1 M-contact tenant before T-004 closes.

## Consequences

- `apps/web` scaffold task (T-005) changes to Vite + TanStack; `apps/site` becomes an Astro task; `docs/03`, `docs/04`, `docs/11` and `AGENTS.md` updated in this PR.
- Performance budgets and the scale plan are binding (`docs/16-performance-and-scale.md`); CI gets bundle-size and Lighthouse checks when `apps/web` exists.
- The API must expose cursor pagination, field selection and ETag/`If-None-Match` on list endpoints from the first endpoint, because the SPA depends on them for speed.
- Sticky sessions required at the load balancer for Socket.IO.
- Go/Bun stay out until a measured bottleneck justifies them; the modular monolith makes extracting `webhook`/`worker` possible later without a rewrite.
- Horizontal scale and per-tenant/vertical extensibility follow `docs/17-multi-tenancy-and-verticals.md`: stateless services, tenant-keyed data/queues/caches/storage, a workspace→database router in `packages/db` from the first migration, and declarative vertical packs instead of per-industry code.
