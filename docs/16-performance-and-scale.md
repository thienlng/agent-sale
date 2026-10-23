# 16 — Performance budgets and scale plan

> Binding targets for "fast, smooth, modern" (owner requirement) and for scaling to ~1,000 tenants. Stack decisions: `docs/adr/ADR-009-tech-stack-for-speed-and-scale.md`. Every task that touches UI or list endpoints must state how it stays within these budgets.

## 1. Frontend budgets (dashboard `apps/web`)

| Metric | Budget | How it is measured |
|---|---|---|
| Initial JS (app shell, gzip) | ≤ 250 KB; each route chunk ≤ 100 KB | `vite build` size report in CI (fails over budget) |
| First load on 4G, mid-range laptop | LCP ≤ 2.0 s, TTI ≤ 2.5 s | Lighthouse CI on `/login` and `/app/inbox` (staging) |
| Route navigation | ≤ 100 ms to render skeleton; ≤ 300 ms p75 to data (cached/prefetched) | TanStack Router preload on hover/intent; Query cache |
| User action feedback | ≤ 100 ms visual response for every click/keypress | Optimistic updates; never block on the network for local state |
| Tables | 100k rows scroll at 60 fps | TanStack Virtual; keyset pagination; server-side filter/sort |
| Realtime | New message visible ≤ 1 s after webhook receipt (p95) | Socket.IO push; measured end-to-end in staging |
| Interaction smoothness | No layout shift (CLS ≤ 0.05); animations 150–250 ms, reduced-motion respected | Lighthouse; design review |
| Accessibility | Lighthouse a11y ≥ 90; keyboard-complete inbox and forms | Lighthouse CI |

Techniques (mandatory patterns, enforced in review):

- **Data layer:** TanStack Query with `staleTime` per resource, background refetch, `placeholderData` for pagination, prefetch on hover/intent, optimistic mutations with rollback, WebSocket invalidation instead of polling.
- **Rendering:** route-level code splitting; skeletons that match final layout; virtualized lists; memoized row components; no blocking modals for async work; `startTransition` for heavy filters.
- **Assets:** static SPA on CDN, immutable hashed files, brotli, HTTP/2; fonts self-hosted with `font-display: swap`; icons tree-shaken (`lucide-react`).
- **UX conventions (modern feel):** command palette (`⌘K`), keyboard shortcuts in inbox (`J/K`, `R`, `E`), inline editing, toasts not alerts, dark mode, dense but readable tables, subtle motion (`motion`) for list changes and panel transitions, View Transitions API where supported.
- **No** heavy client-side state libraries beyond Query + small Zustand stores; **no** moment.js, lodash-full, or chart libraries over 100 KB (use `recharts`/`visx` lazily or a lightweight alternative).

## 2. Backend budgets (`apps/api`, `apps/webhook`)

| Endpoint class | p95 | Notes |
|---|---|---|
| Webhook ack | ≤ 200 ms (p99 ≤ 500 ms) | verify + insert + enqueue only |
| List endpoints (conversations, contacts, orders) | ≤ 150 ms for a page of 50 | keyset pagination, covering indexes, no N+1 |
| Entity read / write | ≤ 100 ms / ≤ 200 ms | — |
| Auth/entitlement checks | ≤ 5 ms | Redis cache (60 s) + in-process LRU |
| Realtime fan-out | ≤ 50 ms server-side | Redis adapter |
| AI reply (end-to-end) | ≤ 8 s p95 | external; streamed to the inbox when possible |

Rules: every list endpoint supports cursor pagination, server-side filter/sort, `fields` selection and `ETag`; every query has an index plan reviewed (`EXPLAIN` attached to the PR for new heavy queries); per-tenant rate limits; response compression; no synchronous third-party calls in request handlers.

## 3. Scale plan to 1,000 tenants

Assumptions (to be replaced by measurements in beta): 1,000 active workspaces · 5 channels each · 1,500–3,000 inbound messages/day/tenant → **1.5–3 M messages/day** (20–35/s average, **bursts ≈ 1,000/s** during ad campaigns) · 60% answered by AI → ~1.5 M LLM calls/day · 3,000 concurrent dashboard users at peak · 1 M contacts for the largest tenant.

| Component | Day 1 (beta) | 1,000 tenants | Scaling mechanism |
|---|---|---|---|
| `web` / `site` | CDN | CDN | none needed |
| `api` | 2 × (1 vCPU, 1 GB) | 6–10 pods | HPA on CPU + latency |
| `webhook` | 2 × small | 4–6 pods | HPA on RPS; stateless |
| `worker` | 2 × medium | per queue: conversation 6–12, outbound 4–8, campaign 2–6, indexer 2 | KEDA on queue depth; per-tenant concurrency caps (noisy neighbor) |
| PostgreSQL | 2 vCPU / 8 GB managed, PITR | 8 vCPU / 32 GB primary + 1 read replica; PgBouncer; partitions on `messages`, `inbound_events`, `ai_runs`, `ledger_entries`, `campaign_recipients` | vertical first, then replica for reads/analytics; Citus or per-tenant DB for outliers |
| Redis | 1 GB HA | 4–8 GB cluster | split queue vs cache instances |
| Object storage | — | ~2 TB/year media | lifecycle to cold tier |
| Storage growth | — | messages ≈ 1 KB each → ~1 TB/year hot; archive partitions > 12 months to S3 (Parquet) | retention policy per plan |
| LLM | 1 provider | 2+ providers, pooled rate limits, prompt caching, tier routing | cost ≈ the dominant variable cost; tracked per tenant |

Noisy-neighbor protection: BullMQ group concurrency per `workspace_id`, per-tenant rate limits on API and AI, campaign sends throttled per channel, circuit breakers per external provider.

Capacity tests before GA (Rule, see `docs/13`): sustained 100 msg/s for 1 h and burst 1,000 msg/s for 5 min with p95 budgets held; 3,000 concurrent WebSocket clients; 1 M-contact tenant list/filter under 150 ms.

## 4. What we measure in production

RED metrics per endpoint and per queue; p95 dashboards per tenant tier; Web Vitals from real users (`web-vitals` → analytics); bundle size trend per release; DB slow-query log (> 100 ms) reviewed weekly; cost per tenant (AI, infra).
