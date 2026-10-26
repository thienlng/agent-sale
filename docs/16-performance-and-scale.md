# 16 — Performance budgets and scale plan

> Binding targets for "fast, smooth, modern" (owner requirement) and for scaling to ~1,000 tenants. Stack decisions: `docs/adr/ADR-009-tech-stack-for-speed-and-scale.md`. Every task that touches UI or list endpoints must state how it stays within these budgets.

## 1. Frontend budgets (dashboard `apps/web`)

| Metric | Budget | How it is measured |
|---|---|---|
| Initial JS (app shell, gzip) | ≤ 250 KB; each route chunk ≤ 100 KB (charts, `motion`, extra i18n namespaces lazy-loaded — only the Vietnamese catalog is bundled, English loads on first switch via `@agent-sales/i18n/en`; realtime via SSE/`ws`, not `socket.io-client`, in the shell) | `size-limit` in CI (fails at > 5 % over budget) |
| First load on 4G, mid-range laptop | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at p75 (Core Web Vitals); static shell with skeleton + inline critical CSS; one `/bootstrap` call (session, workspace, entitlements, flags) after cookie refresh, no auth flash | Lighthouse CI on `/login` and an authenticated `/app/inbox` run (staging); RUM `web-vitals` in production |
| Route navigation | ≤ 100 ms to render skeleton; ≤ 300 ms p75 to data (cached/prefetched) | TanStack Router preload on hover/intent; Query cache |
| User action feedback | ≤ 100 ms visual response for every click/keypress | Optimistic updates; never block on the network for local state |
| Tables | Render a 50-row page in ≤ 16 ms; infinite scroll over a virtualized window without jank on a 1 M-row tenant | TanStack Virtual; keyset pagination; server-side filter/sort (rows are never all client-side) |
| Realtime | New message visible ≤ 1 s after webhook receipt (p95) | SSE push from Redis pub/sub; resume via `Last-Event-ID`; measured end-to-end in staging |
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
| Realtime fan-out | ≤ 50 ms server-side | Redis pub/sub → SSE |
| AI reply (end-to-end, normal load) | ≤ 8 s p95 | external; streamed only to the website widget (SSE); Messenger/Zalo cannot stream |
| AI reply under burst (degradation mode) | ack + holding message ≤ 1 s; reply ≤ 5 min p95 for standard tier, ≤ 1 min for priority tier | admission controller (§2b); SLO is explicitly a degradation SLO during ad campaigns |

Rules: every list endpoint supports cursor pagination, server-side filter/sort, `fields` selection and `ETag`; every query has an index plan reviewed (`EXPLAIN` attached to the PR for new heavy queries); per-tenant rate limits; response compression; no synchronous third-party calls in request handlers.

## 2b. LLM admission control (the real bottleneck)

A 1,000 msg/s burst with ~60 % AI-answered messages is ~36,000 LLM requests/min — above any self-serve provider tier (Anthropic Scale ≈ 10k RPM per model class, OpenAI Tier 5 ≈ 30k RPM) and subject to acceleration limits. Therefore `ai-core` contains an **admission controller**:

- Redis token buckets per provider × model class for RPM / input TPM / output TPM, refilled from the providers' `*-remaining` / `retry-after` response headers.
- Priority by tenant tier (`priority` queue drains first), then FIFO per tenant; per-tenant token budgets and daily spend caps enforced *before* each call (graduated: warn → downgrade model/shorten → block + handoff).
- Prompt caching of the static prefix (tools → system → tenant knowledge) with a 1-hour TTL per tenant; on Anthropic, cached input tokens do not count toward ITPM, so a stable prefix multiplies effective throughput.
- One primary provider per tier; failover is a *degraded-cost* mode (cache keys differ per provider) with alerting, not a silent doubling of spend.
- Negotiate custom/enterprise rate limits with providers before GA; the capacity test in §3 is run against the negotiated limits, not the self-serve ones.

## 3. Scale plan to 1,000 tenants

Assumptions (to be replaced by measurements in beta): 1,000 active workspaces · 5 channels each · 1,500–3,000 inbound messages/day/tenant → **1.5–3 M messages/day** (20–35/s average, **bursts ≈ 1,000/s** during ad campaigns) · 60% answered by AI → ~1.5 M LLM calls/day · 3,000 concurrent dashboard users at peak · 1 M contacts for the largest tenant.

| Component | Day 1 (beta) | 1,000 tenants | Scaling mechanism |
|---|---|---|---|
| `web` / `site` | CDN | CDN | none needed |
| `api` | 2 × (1 vCPU, 1 GB) | 6–10 pods | HPA on CPU + latency |
| `webhook` | 2 × small | 4–6 pods | HPA on RPS; stateless |
| `worker` | 2 × medium | per queue: conversation 6–12, outbound 4–8, campaign 2–6, indexer 2 | KEDA on queue depth; per-tenant concurrency caps (noisy neighbor) |
| PostgreSQL (self-hosted, Patroni + pgBackRest) | 1 node 4 vCPU / 16 GB (+ 1 standby), PITR | 8–16 vCPU / 64 GB primary + 1 sync standby + 1 read replica; PgBouncer; NVMe; partitions only where allowed by docs/05 §9 | vertical first, then replica for reads/analytics; dedicated DB for outliers via `tenant_routes` |
| Redis | 1 GB HA | 4–8 GB cluster | split queue vs cache instances |
| Object storage | — | ~2 TB/year media | lifecycle to cold tier |
| Storage growth | — | messages ≈ 1 KB each → ~1 TB/year hot; archive partitions > 12 months to S3 (Parquet) | retention policy per plan |
| LLM | 1 provider | 2+ providers, pooled rate limits, prompt caching, tier routing | cost ≈ the dominant variable cost; tracked per tenant |

Noisy-neighbor protection: our own fairness layer (`packages/queue`: Redis token bucket per `workspace_id` and per `channel_connection_id`, re-delay with jitter when over budget, tier queues with weighted workers — open-source BullMQ has no per-group limits, see ADR-003), per-tier `statement_timeout` and pooler connection caps, per-tenant rate limits on API and AI, campaign sends throttled per channel, circuit breakers per external provider.

What breaks first under burst, in order: provider RPM/acceleration limits → `agent` queue backlog → wallet row lock for the bursting tenant (mitigated by the separate debit transaction, ADR-008) → Postgres write TPS (~8 writes per inbound message; 8 vCPU primary is at the edge at 1,000 msg/s — hence degradation mode, not "hold p95").

Capacity tests before GA (see `docs/13`): sustained 100 msg/s for 1 h with normal-load budgets held; burst 1,000 msg/s for 5 min with the **degradation** budgets held (ack ≤ 1 s, no dropped messages, priority tier ≤ 1 min); 3,000 concurrent SSE clients surviving a rolling deploy; 1 M-contact tenant list/filter under 150 ms with the RLS role.

## 4. What we measure in production

RED metrics per endpoint and per queue; p95 dashboards per tenant tier; Web Vitals from real users (`web-vitals` → analytics); bundle size trend per release; DB slow-query log (> 100 ms) reviewed weekly; cost per tenant (AI, infra).

## Root recovery dependency budget (T-076)

Always-loaded route recovery controls use native links/buttons with design tokens rather than pulling the shared Button, Slot and class-merging helpers into the initial graph. Not-found navigation, reload recovery, keyboard interaction and localized labels remain available. The 250 KB gzip entry budget is unchanged; the reviewed lane B build measured 246.7 KB, down from 257.6 KB before this change.
