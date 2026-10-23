# Adversarial review: ADR-009 stack and scale plan (docs/16, docs/17, docs/04, docs/05, ADR-001…008)

Reviewer stance: principal engineer, independent. Scope: what is wrong, unverified, contradictory, or mis-sized. Findings are ordered by severity. "Verified" means checked against a primary source today (2026-10-23).

---

## BLOCKER

### B1. RLS context via `SET app.workspace_id` behind PgBouncer transaction pooling leaks tenants
- **Claim:** docs/04 §9 "`SET app.workspace_id` per transaction"; ADR-004 "the app sets `app.workspace_id` in every transaction"; ADR-009 "PgBouncer (transaction pooling)".
- **Problem:** A plain `SET` is session-scoped. In transaction pooling the server connection returns to the pool after each transaction with the GUC still set; the next client that borrows it (a different tenant's request, or a worker that forgot to set context) runs under the previous tenant's `workspace_id`. The most severe incident in docs/09 ("cross-tenant leakage") becomes a routine race. `server_reset_query` does not run in transaction mode, so nothing clears it. Verified: [Netdata PgBouncer guide](https://www.netdata.cloud/guides/pgbouncer/pgbouncer-set-search-path-lost/), [RLS + pooling write-up](https://hashnode.com/posts/postgres-row-level-security-for-multi-tenant-saas-a-setup-that-holds-up/6ac9181e52c978b433ae915b).
- **Second trap in the same path:** postgres.js uses named prepared statements by default; PgBouncer only supports them in transaction mode from 1.21 (`max_prepared_statements`). Older/managed PgBouncers (and Supavisor) require `prepare: false`. Verified: [Crunchy Data](https://www.crunchydata.com/blog/prepared-statements-in-transaction-mode-for-pgbouncer), [Supabase troubleshooting](https://supabase.com/docs/guides/troubleshooting/disabling-prepared-statements-qL8lEL.md).
- **Recommendation:** (1) Only `set_config('app.workspace_id', $1, true)` / `SET LOCAL`, inside an explicit transaction, every time. (2) Export a single `withTenant(workspaceId, fn)` from `packages/db` that opens the tx and sets the GUC; ESLint-ban importing the raw `db` handle outside `packages/db`. (3) Policies use `current_setting('app.workspace_id')::uuid` *without* `missing_ok` so a missing context errors loudly instead of returning zero rows silently. (4) Pin PgBouncer ≥ 1.21 with `max_prepared_statements=200`, or set `prepare: false` and accept the loss. (5) Add a CI integration test that runs two tenants through one PgBouncer connection sequentially and asserts isolation.

### B2. Monthly partitioning breaks the uniqueness that ADR-008 and idempotency rely on
- **Claim:** docs/05 §4/§8: `messages(... idempotency_key UNIQUE ...)` "monthly partitions"; `ledger_entries(... idempotency_key UNIQUE ...) -- partition`; `inbound_events(... UNIQUE(channel_kind, external_event_id)) -- monthly partitions`; `messages.ai_run_id → ai_runs` and `ai_runs.trigger_message_id → messages` as FKs between two partitioned tables. ADR-008: "No double deduction on retry" via the unique idempotency key.
- **Problem:** PostgreSQL only allows unique/primary constraints on a partitioned table if they include the partition key. So `idempotency_key UNIQUE` on a `created_at`-partitioned table is either rejected or becomes `(idempotency_key, created_at)`, which no longer dedupes a retry that lands in a different month (or even a different second, if `created_at` is `now()`). Concretely: a BullMQ retry at 23:59:59 → 00:00:01 on month boundary double-debits the wallet; a Meta webhook redelivered across the boundary processes twice. FKs that reference partitioned tables must reference the full composite key, so `messages ↔ ai_runs` becomes `(id, created_at)` on both sides — plus detach-partition becomes painful. Verified: [2ndQuadrant on PG12 FKs/partitions](https://www.2ndquadrant.com/en/?p=31590), [pgsql-general thread](https://postgresql.org/message-id/CAABu8T_ZZAFJykKFb-q3ZF8QWLDV8zXNP0jx7QPb6wWVE%2B_o2A%40mail.gmail.com).
- **Recommendation:** Do not partition `ledger_entries` (volume is 1 row per AI run; a 1-year table of ~500 M rows is fine as a single btree-indexed table, and it is append-only). Keep global uniqueness for `messages.idempotency_key` and `inbound_events` dedup in small *unpartitioned* key tables (`message_keys(key PK, message_id, created_at)`, `inbound_event_keys`) or in Redis `SET NX EX 7d` plus a DB fallback. Drop FKs across partitioned tables; keep `ai_run_id` as a plain indexed column. Make partition keys `(workspace_id, created_at)`-aware only where an index-only tenant scan matters. Write these rules into docs/05 §9 before T-004 scaffolds `packages/db`.

---

## HIGH

### H1. Noisy-neighbor design depends on BullMQ *Pro* features
- **Claim:** docs/16 §3 "BullMQ group concurrency per `workspace_id`"; docs/17 §6 "BullMQ groups keyed by `workspace_id` with per-tenant concurrency caps"; docs/04 §4 "per-group rate limiting (per page/OA)".
- **Problem:** Groups, per-group concurrency and per-group rate limits exist only in BullMQ Pro (commercial license, `WorkerPro`). Open-source BullMQ has a global worker concurrency and a global queue rate limiter. Verified: [BullMQ Pro groups/concurrency docs](https://docs.bullmq.io/bullmq-pro/groups/concurrency). The fairness story in two docs is currently unbudgeted and unimplementable as written.
- **Recommendation:** Decide now: buy BullMQ Pro (one line in the budget), or implement fairness yourself: Redis token bucket per `workspace_id` and per `channel_connection_id`, checked at job start, with `worker.rateLimit()`/`moveToDelayed` re-queue; plus separate queues per tenant tier (`conversation:std`, `conversation:priority`). Also note the "per page/OA" send limit needs the same mechanism.

### H2. The webhook, scheduler, admin and billing paths cannot run under the RLS role — a system role is undefined
- **Claim:** ADR-004 "the app's DB role does not have BYPASSRLS"; docs/05 `inbound_events(workspace_id NULL …)`; docs/04 §6 webhook ingress inserts `inbound_events` before knowing the tenant.
- **Problem:** Ingress must look up `channel_connections` by `(kind, external_id)` across all tenants before any `workspace_id` is known; the scheduler, outbox publisher, nightly ledger reconciliation (ADR-008), back-office (`ADM-*`), affiliate commissions and analytics rollups all read across tenants. With one RLS-bound role and `FORCE ROW LEVEL SECURITY`, these either fail or push agents to "temporarily" set a wildcard. Nothing in the docs defines the second role, its policies (`app.is_system = 'true'`), or which processes get it.
- **Recommendation:** Define two DB roles in `packages/db`: `app_tenant` (RLS, used by API and tenant-scoped jobs) and `app_system` (RLS policy `OR current_setting('app.role') = 'system'`, no `BYPASSRLS`, audited, used only by ingress, scheduler, outbox, reconciliation, admin). List the allowed processes in ADR-004. Make `inbound_events` lookups a single `SECURITY DEFINER` function so ingress has no general cross-tenant read.

### H3. The burst envelope is not reachable on LLM provider limits; the SLO will be broken by every ad campaign
- **Claim:** docs/16 §3 "bursts ≈ 1,000/s during ad campaigns … 60% answered by AI"; §2 "AI reply ≤ 8 s p95"; docs/10 §5 SLO "99% of eligible messages answered within 15 s"; docs/16 §3 capacity test "burst 1,000 msg/s for 5 min with p95 budgets held".
- **Problem:** 1,000/s × 60% = 600 LLM calls/s = 36,000 RPM (debounce reduces this somewhat, but not 10×). Anthropic's highest self-serve tier (Scale) is 10,000 RPM per model class, and the docs warn of separate *acceleration* limits on sharp increases; OpenAI Tier 5 is 30,000 RPM for GPT-4.1 mini. Verified: [Anthropic rate limits](https://platform.claude.com/docs/en/api/rate-limits), [OpenAI GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini). Even pooling two providers at their top tiers you cannot "hold p95" at 1,000/s; the conversation queue backlogs (300 k jobs in 5 min), the ≤ 30 s queue-wait alert fires, and the SLO is missed. Downstream, each message is ~8 writes (inbound_event, message, conversation, contact upsert, ai_run, ledger, wallet, outbox) = ~8 k write TPS on an 8 vCPU primary with RLS — at the edge, and the `wallets` row lock per tenant serialises one tenant's burst.
- **What breaks first, in order:** provider RPM/acceleration limits → conversation queue backlog → wallet row lock for the bursting tenant → Postgres write TPS.
- **Recommendation:** Rewrite the burst target as a *degradation* SLO: at burst, acknowledge in ≤ 1 s with a configurable holding message, prioritise by tenant tier, and answer within N minutes. Design the "pooled rate limits" that docs/16 names but never specifies: Redis token buckets per provider × model class for RPM/ITPM/OTPM, fed by the providers' `*-remaining`/`retry-after` headers, with an admission controller in `ai-core`. Use prompt caching deliberately: on Anthropic, cached input tokens do not count toward ITPM, so a stable system frame multiplies effective throughput. Negotiate Custom/enterprise tiers before GA. Make the ledger debit a separate tiny transaction, never inside the LLM call.

### H4. "Workspace→DB router from the first migration" is a promise the tooling cannot keep as described
- **Claim:** docs/17 §6, docs/05 §8b, ADR-009 Consequences: router in `packages/db` "from the first migration"; T-004 must include it.
- **Problem:** A real router needs: (a) a declared split of *global* tables (`users`, `sessions`, `plans`, `vouchers`, `affiliate_*`, `admin_units`, `vertical_packs`, `feature_flags`, `audit_events`?) vs tenant tables — not in docs/05; (b) FKs that cross that split (`members.user_id → users`, `notifications.user_id`, `referrals.workspace_id`) dropped or duplicated; (c) a migration runner that applies Drizzle migrations to N databases and records versions per DB (drizzle-kit `migrate` is single-target); (d) per-request/per-job connection resolution in NestJS DI and BullMQ processors; (e) no cross-DB transactions (ledger + order in one tx is fine, but affiliate commission + payment is not). None of this is designed, and with every tenant on one DB for the first 2 years the code path will rot untested. Drizzle's RLS support is real (`pgPolicy`, drizzle-orm 0.36 / drizzle-kit 0.27) but drizzle-kit has no declarative partitioning or pg_partman support, so partitions and policies will live in hand-written SQL migrations anyway. Verified: [Drizzle RLS docs](https://orm.drizzle.team/docs/rls), [drizzle-kit 0.27.0 release](https://github.com/drizzle-team/drizzle-orm/releases/tag/drizzle-kit@0.27.0).
- **Recommendation:** Either make it real (table classification in docs/05, multi-target migration runner, a CI job that boots two tenant DBs and runs the integration suite) or reduce the claim to what is cheap and true: "all tenant access goes through `withTenant()`; no cross-tenant FKs on tenant tables; global tables are listed". For 1,000 SME tenants, a larger primary plus hash sub-partitioning of `messages` by `workspace_id` is the realistic path; Citus/dedicated DB can be a later ADR. Also: ban `drizzle-kit push` (it will try to reconcile partitions/policies it does not understand); use `generate` + custom SQL + a lock-safety linter (e.g. squawk).

### H5. Auth token storage in the SPA is unspecified and the "bearer only" constraint pushes agents toward localStorage
- **Claim:** ADR-009 Mobile readiness: "bearer tokens (no cookie-only auth)"; docs/11 §2 `Authorization: Bearer`; ADR-007/docs/09: 15-min access JWT + opaque refresh with rotation.
- **Problem:** Nothing says where the SPA stores the refresh token. The default an agent will write is `localStorage`, so any XSS (a third-party widget, a Markdown renderer in the inbox, a malicious attachment preview) exfiltrates a long-lived, rotating credential. Reuse-detection only helps *after* the attacker has used it.
- **Recommendation:** Access token in memory only; refresh token in an `HttpOnly; Secure; SameSite=Lax` cookie scoped to `api.<domain>/api/v1/auth/refresh` with an `Origin` check; mobile/native clients get the refresh token in the response body via a `client=native` flag. This still satisfies "bearer for every API call". Add a strict CSP (no `unsafe-inline`), sanitise all rendered message HTML, and document the SPA boot sequence (see M6).

---

## MEDIUM

### M1. Socket.IO lives inside the `api` deployment; deploys and HPA will cause reconnect storms
- **Claim:** ADR-009 "Socket.IO with Redis adapter (sticky sessions at the load balancer)"; docs/04 §3 "API service REST + WebSocket"; docs/16 "6–10 api pods, HPA on CPU".
- **Problem:** Every API rollout (daily with agents) and every scale-down disconnects all 3,000 inbox clients at once; sticky cookie affinity behind Cloudflare works but Cloudflare itself restarts edge servers and closes idle sockets (no published per-plan limits; keepalive required). Verified: [Cloudflare WebSockets](https://developers.cloudflare.com/network/websockets/). Long-polling fallback + stickiness is the only reason stickiness is needed at all.
- **Recommendation:** Same image, separate `realtime` Deployment with long `terminationGracePeriod`, `transports: ['websocket']` (drops the sticky requirement), client reconnect with jitter and a "resync since `last_seq`" call on reconnect. Measure Cloudflare's idle cut-off in staging and set `pingInterval` below it.

### M2. pgvector plan: hash partitions by `bot_id` + HNSW gives silent recall loss; fixed `VECTOR(1536)` locks the model
- **Claim:** docs/17 §6 "`knowledge_chunks` partitioned by `bot_id` hash so HNSW indexes stay small per partition"; docs/05 `embedding VECTOR(1536)`; ADR-002 "consider Qdrant beyond ~50 M chunks".
- **Problem:** A hash partition still holds hundreds of bots; `WHERE bot_id = ?` is post-filtered after HNSW returns `ef_search` (40) candidates, so a bot that is 1% of its partition gets ~0 results. pgvector 0.8 iterative scans mitigate at a latency cost. Verified: [pgvector 0.8.0 release](https://www.postgresql.org/about/news/pgvector-080-released-2952), [recall-loss write-up](https://hashnode.com/posts/filtered-vector-search-in-pgvector-can-silently-lose-recall/6a5ea5bf7934007949197ec0). `VECTOR(1536)` assumes text-embedding-3-small; bge-m3 is 1024, Gemini/3-large are 3072 — switching models (which ADR-005 promises) means a rebuild.
- **Recommendation:** Most SME bots have < 10 k chunks: use a btree on `(bot_id)` and an exact scan (no HNSW) by default; add a partial HNSW index only for bots above a threshold; require pgvector ≥ 0.8 with `hnsw.iterative_scan = relaxed_order`. Store embeddings in a per-model table (`knowledge_embeddings_<model>`) or use `halfvec` with the dimension per model. The 50 M-chunk Qdrant trigger is irrelevant; the filter problem bites at 50 k.

### M3. RLS + non-leakproof operators may defeat trigram/ILIKE indexes on the 1 M-contact tenant
- **Claim:** docs/16 §3 "1 M-contact tenant list/filter under 150 ms"; docs/05 GIN trigram on contact name.
- **Problem:** Under RLS the planner cannot push non-leakproof user quals (`ILIKE`, pg_trgm `%`) below the security barrier; depending on plan shape this forces a tenant-wide scan before the search predicate. This is a known RLS performance class, and no `EXPLAIN` under the RLS role exists yet.
- **Recommendation:** Spike before committing budgets: run the contact search with the RLS role on a 1 M-row tenant; put `workspace_id` first in every composite index; write policies as `workspace_id = (select current_setting(...)::uuid)` (InitPlan, not per-row); if needed route search through a `SECURITY DEFINER` function that takes `workspace_id` explicitly.

### M4. Observability stack is far too large for two human operators
- **Claim:** docs/04 §4: OTel → Tempo + Loki + Prometheus/Mimir + Grafana, Sentry, self-hosted Langfuse, ClickHouse later; docs/10 local compose includes Langfuse.
- **Problem:** Langfuse v3 self-host is itself Postgres + ClickHouse + Redis + S3 + web + worker; at ~1.5 M traces/day it is a second data platform. Verified: [Langfuse self-hosting](https://langfuse.com/self-hosting) (MIT core; some features EE-gated). Together with K8s, Argo CD, Terraform, Helm, KEDA, PgBouncer, Redis HA and 8–9 deployables, this is more stateful systems than a 2-reviewer team can keep patched.
- **Recommendation:** Managed observability (Grafana Cloud or one vendor) and Langfuse Cloud or trace sampling (100% errors, 5–10% success) until GA; one `worker` image with `WORKER_QUEUES` selecting `agent`/`outbound`/`campaign`/`indexer`/`scheduler` (docs/11 already hints at this) so there are 4 deployables (web/site static, api, webhook, worker) instead of 9. Note KEDA has no BullMQ scaler; use the `redis-lists` scaler on `bull:<queue>:wait` or a tiny `/metrics` exporter — write this down, agents will otherwise guess.

### M5. Streaming, prompt caching and provider pooling are named but not designed; streaming has little product value
- **Claim:** ADR-009 "streaming where the UI can show it"; docs/16 §3 "pooled rate limits, prompt caching"; docs/06 §7 prompt caching of the system part.
- **Problem:** The agent runs in a separate process consuming BullMQ; token streaming to the inbox needs a Redis pub/sub channel → `api` → Socket.IO, which is not drawn anywhere. Messenger/Zalo cannot stream at all, so streaming benefits only the website widget and a staff "preview". Prompt-cache keys differ per provider, so the ADR-005 fallback chain doubles cost on failover. No eval runner is chosen (`evals/` exists; docs/06 mandates ≥ 300 cases) and no replay/shadow-mode design exists for model changes.
- **Recommendation:** Drop streaming from P0 except for the widget (SSE from `api`, not Socket.IO). Specify the pooling controller (H3). Pin a single primary provider per tier and treat fallback as degraded-cost mode with alerting. Pick promptfoo or an in-house runner now and wire it to the CI gate in docs/10.

### M6. First-load claim for the SPA is weaker than stated; budget arithmetic is tight; table claim contradicts pagination
- **Claim:** ADR-009 "Vite SPA on CDN … instant"; docs/16 §1 "LCP ≤ 2.0 s, TTI ≤ 2.5 s on 4G", "initial JS ≤ 250 KB", "100 k rows scroll at 60 fps".
- **Problem:** The SPA boot is a serial waterfall: HTML → 250 KB JS → `/auth/refresh` → `/me` → `/workspaces` → entitlements → first render, with an unauthenticated "flash" if not handled. Next.js was not slow for this app because of SSR; it was heavier for *navigation*. The ADR is right on navigation and wrong to imply first load wins. React 19 + Router + Query + Table + Virtual + Radix + i18next + socket.io-client + `motion` + RHF + Zod + cmdk is ≈ 230–280 KB gzip before any feature code; recharts alone exceeds the 100 KB route chunk. "100 k rows at 60 fps" with keyset pagination means 100 k rows are never client-side; the real metric is "virtualised infinite window". Tailwind v4 + shadcn/ui + React 19 is fine (verified: [shadcn changelog](https://ui.shadcn.com/docs/changelog/2025-02-tailwind-v4)); TanStack Router v1 is stable.
- **Recommendation:** Serve a static shell with skeleton + inline critical CSS; add a single `/bootstrap` endpoint (session + workspace + entitlements + flags); refresh via cookie before first paint (H5); lazy-load `motion`, charts, i18n namespaces (vi only by default); raise the shell budget to 300 KB or cut `motion`/`socket.io-client` (plain `ws` is 0 KB); rewrite the table budget as "render 50-row page in ≤ 16 ms, infinite scroll without jank".

---

## LOW

### L1. Internal contradictions agents will trip on
- Webhook ingress is "Thin Fastify app (no Nest)" (ADR-009), "lightweight NestJS/Fastify" (docs/11), part of the "NestJS modular monolith" (docs/04 §3). Pick one.
- Webhook ack budget: p99 < 200 ms (ADR-009), p95 ≤ 200 / p99 ≤ 500 (docs/16), p99 < 500 (docs/04). Pick one.
- docs/04 §4 still says "Prisma *or* Drizzle, class-validator/Zod"; docs/05 §9 "Prisma Migrate / Drizzle Kit"; ADR-009 decides Drizzle + Zod. Update.
- docs/04 §3 shows separate `scheduler` and `knowledge-indexer` processes; ADR-009 says "one deployment per queue group"; docs/10 Stage 1 has `scheduler ×1 (leader lock)` although BullMQ repeatable jobs remove the need for a leader.
- ADR README lists 009 before 008.

### L2. Minor compatibility notes (verified, no action beyond pinning)
- NestJS 11 + Fastify 5 + `@nestjs/platform-socket.io` works; pin `@nestjs/platform-fastify ≥ 11.1.11` (middleware-bypass advisory when path-normalisation options are enabled) and do not enable `ignoreTrailingSlash` on the Socket.IO path. Source: [tessl registry note on CVE-2026-2293](https://tessl.io/registry/tessl/npm-nestjs--platform-fastify).
- BullMQ on Redis Cluster needs hash-tagged queue prefixes; prefer primary/replica + Sentinel for the queue instance, Cluster only for cache.
- Lighthouse CI on `/app/inbox` needs an authenticated run; budget a login script.

### L3. Missing items that are cheap to add now
- Feature-flag evaluation path (table exists; no SDK/cache/kill-switch semantics; needed for "canary 10%" and per-workspace beta).
- API deprecation policy for `/api/v1` once the public API (P2) ships.
- Secrets: KMS/Vault named in docs/09 but no local-dev story (agents will commit `.env`).
- Cost guardrail: per-tenant AI spend cap enforced in `ai-core`, not only "visible on the usage page".

---

## Summary ranking
1. B1 — `SET app.workspace_id` + PgBouncer transaction pooling leaks tenants; must be `set_config(..., true)` inside a mandatory `withTenant()` tx, plus PgBouncer ≥ 1.21 or `prepare: false`.
2. B2 — Monthly partitions make `idempotency_key UNIQUE` and cross-partitioned FKs impossible; ADR-008's no-double-debit guarantee and webhook dedup are broken as designed.
3. H1 — Per-tenant group concurrency/rate limits are BullMQ Pro only; the noisy-neighbor design is unbudgeted.
4. H3 — 1,000 msg/s burst ⇒ ~36 k LLM RPM, above any self-serve provider tier; the 8 s p95 / 15 s SLO cannot hold, and no admission controller is designed.
5. H4 — The "workspace→DB router from the first migration" has no table classification, migration runner or test path; either make it real or downgrade the claim.
