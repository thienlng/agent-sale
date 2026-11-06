# 16 — Performance budgets and scale plan

> Binding targets for "fast, smooth, modern" (owner requirement) and for scaling to ~1,000 tenants. Stack decisions: `docs/adr/ADR-009-tech-stack-for-speed-and-scale.md`. Every task that touches UI or list endpoints must state how it stays within these budgets.

## 1. Frontend budgets (dashboard `apps/web`)

| Metric | Budget | How it is measured |
|---|---|---|
| Initial JS (app shell, gzip) | ≤ 250 KB; each route chunk ≤ 100 KB (charts, `motion`, extra i18n namespaces lazy-loaded — only the Vietnamese catalog is bundled, English loads on first switch via `@agent-sales/i18n/en`; a page-only namespace such as `integration` ships as its own entry (`@agent-sales/i18n/integration`, both locales) that the route loader adds through `loadNamespace` in `apps/web/src/lib/i18n.ts` (the hotel pages' `lodging` namespace loads the same way from the calendar, bookings and properties routes, the hotel bot's places page and the inbox; shell strings such as nav labels and the pending-holds count stay in `common`); the owner assistant panel and its `assistant` namespace load only when the owner first opens the bubble, and its chart (`assistant-chart`, recharts) is a separate lazy chunk loaded only when an answer has a chart; the notification bell's list and its `notification` namespace load on the first open of the bell (the badge alone is eager); realtime via SSE/`ws`, not `socket.io-client`, in the shell) | `size-limit` in CI (fails at > 5 % over budget) |
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
| Owner assistant SQL lane (T-171) | 3 s statement timeout, ≤ 500 rows (501 fetched to detect truncation), ≤ 8 000 chars of result to the model, ≤ 8 `sql_query` calls and ≤ 3 charts per turn | own login with a pool of 4 per `api` process (`CONNECTION LIMIT 10`), `READ ONLY` transaction, 1 s lock timeout, 16 MB `work_mem`; runs on the primary inside the 90 s turn and counts against the 40 000-char tool output budget |
| Shop-bot turn trace write (T-174) | ≤ 5 ms p95 | one insert transaction (one `ai_run_traces` row, ≤ 61 `ai_run_steps` rows) after the `ai_runs` row, before `reply` returns: it delays only the final message (`send_message` output already went out); best-effort, a failure is logged and counted (`ai_trace_write_failures_total`), never thrown |
| Shop-bot turn trace purge (T-174) | ≤ 20 batches of 5 000 rows per hourly pass | `AiTraceRunner.purgeExpired` in the `agent` process (first pass 5 min after start, a busy flag skips an overlapping tick), `app_system`, under an advisory lock so one replica works at a time; deletes by the `created_at` indexes, never touches `ai_runs` |
| Owner assistant chat turn (T-170, 1a/1b) | ≤ 90 s hard budget, ≤ 25 rounds, ≤ 40 000 chars of tool output | synchronous request below the proxy read timeout; route tool reads (in-process `inject`) and a compaction at the start of the turn (≤ 30 s, the model keeps ≥ 30 s) run inside the same 90 s; steps polled once a second (`GET /assistant/runs/{id}`); SSE streaming later |
| Owner assistant background review and curator (T-170, 1c) | worker tick every 15 s, ≤ 3 jobs per tick run side by side, 5-min lease; a review ≤ 8 rounds, 120 s and 200 000 input tokens (cached included) | off the request, in the `worker` process on Postgres-leased `assistant_jobs` (no BullMQ, ruling 1c-R1); every review write re-checks the lease (≥ 30 s left); a failed review retries once after 10 min. The curator makes no LLM call; its cross-account owner scan runs at most every 10 min per worker and enqueues at most one job per owner per day |
| Owner assistant photo import and import approval (T-173) | photo drafting ≤ 55 s (≤ 8 photos, 4 vision calls at a time, 25 s each); approval ≤ 60 s, ≤ 200 products | synchronous, owners only, under the T-170 exception; drafting holds the owner's turn lock; approval runs `POST /products` injects one at a time so one approval cannot flood the pool, and drafts past the deadline are reported `not_run` |
| Notification unread count (`GET /notifications/unread-count`, T-172) | ≤ 5 ms | index-only count on the partial unread index; the bell polls once a minute and on window focus, per open tab |
| Assistant schedule runner tick (worker, T-172) | ≤ 10 schedules per pass, ≤ 3 facade reads per report, every 15 s, one tick at a time per process | claimed with `FOR UPDATE SKIP LOCKED` and a 5-minute lease; commentary (optional) is one tier-`basic` call capped at 30 s |
| Notification delivery tick (worker, T-172) | ≤ 20 deliveries per pass, every 5 s, one tick at a time per process | 2-minute lease; email at most 20 per user per 24 h |
| AI reply under burst (degradation mode) | ack + holding message ≤ 1 s; reply ≤ 5 min p95 for standard tier, ≤ 1 min for priority tier | admission controller (§2b); SLO is explicitly a degradation SLO during ad campaigns |

Rules: every list endpoint supports cursor pagination, server-side filter/sort, `fields` selection and `ETag`; every query has an index plan reviewed (`EXPLAIN` attached to the PR for new heavy queries); per-tenant rate limits; response compression; no synchronous third-party calls in request handlers. Exception (T-170, 1a, kept in 1b): the owner assistant turn runs synchronously within 90 s, owners only, one turn per owner; route tool reads and a compaction run inside the same 90 s budget. It moves off the request with streaming in a later slice (spec §19). The same exception covers the product import (T-173): drafting a photo batch with a vision model when it is created (≤ 55 s) and running an approved import (≤ 60 s, sequential); both can move to a worker job later (the batch has a `drafting` status for it).

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

Always-loaded route recovery controls use native links/buttons with design tokens rather than pulling the shared Button, Slot and class-merging helpers into the initial graph. Not-found navigation, reload recovery, keyboard interaction and localized labels remain available. The 250 KB gzip entry budget is unchanged; the integration-based snapshot measured 246.7 KB, down from 257.6 KB before this change. After rebasing onto main (which also loads English catalogs on demand), the final lane B build measured 223.2 KB.
