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
| Realtime | Socket.IO with Redis adapter (sticky sessions at the load balancer). | Inbox push < 1 s; scales horizontally. |
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

## Consequences

- `apps/web` scaffold task (T-005) changes to Vite + TanStack; `apps/site` becomes an Astro task; `docs/03`, `docs/04`, `docs/11` and `AGENTS.md` updated in this PR.
- Performance budgets and the scale plan are binding (`docs/16-performance-and-scale.md`); CI gets bundle-size and Lighthouse checks when `apps/web` exists.
- The API must expose cursor pagination, field selection and ETag/`If-None-Match` on list endpoints from the first endpoint, because the SPA depends on them for speed.
- Sticky sessions required at the load balancer for Socket.IO.
- Go/Bun stay out until a measured bottleneck justifies them; the modular monolith makes extracting `webhook`/`worker` possible later without a rewrite.
- Horizontal scale and per-tenant/vertical extensibility follow `docs/17-multi-tenancy-and-verticals.md`: stateless services, tenant-keyed data/queues/caches/storage, a workspace→database router in `packages/db` from the first migration, and declarative vertical packs instead of per-industry code.
