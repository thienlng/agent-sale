# Production best practices (Oct 2026) — multi-tenant B2B SaaS with an LLM customer-facing agent

Context: TypeScript monorepo, ~1,000 tenants, multichannel inbox + CRM + orders, 2 human reviewers + coding agents writing most code. Web research, 2026-10-23. Items marked (unverified) came only from secondary sources.

---

## 1. Multi-tenancy on PostgreSQL

**Consensus**
- Shared schema + `tenant_id` + RLS is the default for new B2B SaaS; schema-per-tenant is "generally avoid" at thousands of tenants (catalog bloat, slow migrations), DB-per-tenant is for regulated/white-label whales, and the mature shape is hybrid tiering (shared long tail + dedicated DBs for a few enterprise accounts). — ClickHouse, "How to architect multi-tenant SaaS on Postgres", updated 2026-10-20: https://clickhouse.com/resources/engineering/multi-tenant-saas-postgres-architecture
- Behind transaction-mode poolers (PgBouncer, PgCat, Supavisor port 6543) session `SET` is unsupported and leaks across clients; set tenant context per transaction with `set_config('app.current_tenant_id', $1, true)` and do not rely on `DISCARD ALL`/reset queries as the safety net. — PgBouncer features table (SET/RESET "never" in transaction mode): https://www.pgbouncer.org/features.html ; ClickHouse article above; https://dev.to/m_zinger_2fc60eb3f3897908/why-tenant-context-must-be-scoped-per-transaction-3aop
- Treat RLS as a backstop for developer error, not the primary authz gate; resolve tenant from a non-spoofable source (verified JWT/session), `FORCE ROW LEVEL SECURITY`, app role must not own tables or have `BYPASSRLS`. — ClickHouse 2026; https://dev.to/wenceslaudev/postgres-rls-multi-tenancy-two-traps-that-silently-disable-your-policies-5gn8
- RLS performance: wrap function calls in `(select ...)` so the planner caches them as an initPlan, index policy columns (`(tenant_id, id)` leading), avoid per-row joins in policies, scope policies `TO authenticated`. — Supabase docs: https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv ; https://github.com/orgs/supabase/discussions/14576
- Gotcha: after a transaction-local `set_config`, `current_setting('app.tenant', true)` returns `''` not NULL, so `::uuid` casts fail (22P02) on the next request that forgot to set it; wrap with `NULLIF(..., '')`. — dev.to "two traps" above.
- Sharding is a last resort; order is read replicas → partitioning → offload whales to dedicated DBs via logical replication + a `tenant_database_routes` table in the app's routing layer → hash-sharding on tenant id (Citus). Citus requires tenant id on every table and in every PK/FK; colocate on tenant id, small shared tables become reference tables. — ClickHouse 2026; Citus docs https://docs.citusdata.com/en/v8.0/develop/app_type.html ; Crunchy Data https://crunchydata.com/blog/citus-the-misunderstood-postgres-extension
- Partitioning + RLS: parent policies are not enforced when a child partition is queried directly; `pg_dump` through partitions can expose hidden rows; hash partitioning by tenant spreads by count, not size. — https://www.postgresql.org/message-id/20170619131929.GP1769%40tamriel.snowman.net ; ClickHouse 2026.
- Noisy-neighbor controls: per-tier `statement_timeout`, per-tenant pooler connection caps, tenant-keyed API rate limits, background jobs on dedicated compute, reporting on replicas, time-partitioned event tables. — Neon 2025-04-03: https://neon.com/blog/noisy-neighbor-multitenant ; ClickHouse 2026.

**Contested**
- Neon recommends project-per-tenant on its platform "whenever possible" and RLS only as a floor; everyone else says shared schema first. Auditors sometimes won't accept RLS alone as "physical separation". — https://neon.com/blog/is-postgres-rls-for-everything-and-everyone
- Whether to use RLS at all vs. a repository layer that always filters by `tenant_id` (RLS changes debugging, query shape and ORM ergonomics). — Neon RLS guide https://neon.com/guides/rls-multi-tenant-apps ; makerkit https://makerkit.dev/blog/tutorials/multi-tenant-saas-architecture

**Recommendation for us**
- One Postgres, shared schema, `tenant_id` on every table, composite FKs, `(tenant_id, …)` leading indexes, forced RLS as defense-in-depth; the repository layer also always filters by tenant (keeps agent-written code honest).
- One helper `withTenant(tenantId, fn)`: transaction + `set_config(..., true)` + `SET LOCAL ROLE app_user`; lint rule forbids DB access outside it. Read the GUC with `NULLIF`.
- Transaction-mode pooler from day one; no session state; dedicated direct connection if you need LISTEN.
- Don't partition tenant tables at 1,000 tenants; time-partition `messages`/`events` only. Add a `tenant_routes` table now so moving a whale to its own DB later is a routing update, not a rewrite.
- Per-tier `statement_timeout`, per-tenant API + LLM rate limits, per-tenant job concurrency (§2).

---

## 2. Job queues and fairness in Node

**Consensus**
- Open-source BullMQ has only a global queue rate limiter; per-group rate limiting/concurrency/round-robin fairness ("Groups") is BullMQ Pro (paid). — https://docs.bullmq.io/guide/rate-limiting ; https://docs.bullmq.io/bullmq-pro/groups/concurrency ; https://blog.taskforce.sh/bullmq-pro-edition/
- Postgres-native queues (pg-boss, Graphile Worker) use `SKIP LOCKED`, give transactional enqueue with your business writes, no Redis; Graphile reports 2–3 ms fetch-to-complete for trivial jobs; neither has a built-in per-tenant fairness scheduler and neither ships a GUI. — https://postgraphile.org/postgraphile/5/background-tasks ; https://www.pkgpulse.com/guides/bullmq-vs-bee-queue-vs-pg-boss-job-queues-nodejs-2026
- For durable multi-step workflows, the 2026 field is Temporal (self-host or Cloud, polyglot, heaviest), Inngest (event-driven step functions, managed cloud, OSS dev server), Trigger.dev (Apache-2.0, TS-first, self-hostable), plus Restate/Upstash Workflow/Vercel Workflow. — https://upstash.com/blog/durable-workflow-engines-compared-every-major-option-in-2026 ; https://automationatlas.io/guides/inngest-vs-temporal-2026-comparison/
- Per-tenant fairness is now first-class in the managed/durable tier: Inngest `concurrency.key` (e.g. `event.data.tenantId`) with per-key limits and scheduler fairness across keys; Trigger.dev `concurrencyKey` + `perKey`/`total` limits; Temporal Task Queue Priority + Fairness Keys (weighted round-robin across tenants) GA May 2026, Standalone Activities GA Sept 2026 incl. TypeScript. — https://www.inngest.com/docs/guides/concurrency ; https://trigger.dev/docs/queue-concurrency ; https://temporal.io/blog/task-queue-priority-and-fairness-your-task-queue-your-way ; https://temporal.io/changelog/standalone-activities-durable-job-processing-ga

**Contested**
- Redis queue (BullMQ) vs Postgres queue: BullMQ wins on throughput/ecosystem, Postgres queues win on transactional outbox semantics and one fewer datastore. Vendor comparisons dominate.
- Managed durable runtimes (Inngest/Trigger.dev) vs self-hosted (Temporal): cost at scale, lock-in, and data residency are the arguments; Inngest's strict per-key fairness is an enterprise add-on, so confirm before promising it.

**Recommendation for us**
- Two layers: (a) pg-boss/Graphile Worker in Postgres for short transactional jobs (webhook ingest, outbox) so enqueue is atomic with the order/CRM write; (b) a durable workflow engine for agent loops and multi-step order/handoff flows: Trigger.dev or Inngest with `concurrencyKey = tenantId`; Temporal only if you need polyglot workers.
- Tenant fairness is explicit: per-tenant concurrency key everywhere, per-tier caps, tenant budget check before each LLM step. Don't buy BullMQ Pro just for Groups.

---

## 3. LLM agent architecture in production

**Consensus**
- Start with the simplest thing (single LLM call + retrieval), use workflows (prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer) for predictable tasks, and reserve autonomous agents for open-ended ones; invest in the agent-computer interface (tool docs like docstrings for a junior dev, poka-yoke parameters). — Anthropic, "Building effective agents", 2024-12-19: https://www.anthropic.com/engineering/building-effective-agents
- Context engineering: right-altitude system prompts, minimal viable tool set, just-in-time retrieval over pre-loading, compaction, structured notes, sub-agents returning 1–2k-token summaries. — Anthropic 2025-09-29: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents ; tools: namespace by service, paginate/truncate responses, `response_format` concise/detailed, actionable errors, eval-driven tool iteration — Anthropic 2025-09-11: https://www.anthropic.com/engineering/writing-tools-for-agents
- OpenAI's guide: single agent first; manager pattern (agents as tools) vs decentralized handoffs; layered guardrails (relevance, safety, PII, tool-risk rating) plus human approval for high-risk/irreversible actions; many failures are routing/tool-selection, so evaluate from traces. — https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf ; Agents SDK JS has input/output/tool guardrails with tripwire exceptions: https://openai.github.io/openai-agents-js/guides/guardrails/
- Guardrails only cover the paths they see: handoffs, hosted MCP tools and executors can bypass main-path checks. — https://pub.towardsai.net/openai-agents-sdk-guardrail-coverage-test-the-tool-paths-your-safety-checks-miss-aeea0b537382
- Prompt caching (Anthropic): prefix order tools → system → messages; put breakpoints on the last static block; 5-min TTL writes 1.25x, 1-h writes 2x, reads 0.1x (lower on newest models); min 512–4096 tokens by model; keep tool JSON key order and `tool_choice` stable; cache hits don't count against rate limits. — https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching
- Evals/observability: promptfoo = OSS YAML/CI regression + red-team (now part of OpenAI, unverified); Braintrust = managed evals + tracing + CI gates; Langfuse = OSS/MIT tracing + evals, acquired by ClickHouse 2026-01-16, stays open source. — https://www.braintrust.dev/articles/braintrust-vs-promptfoo ; https://clickhouse.com/blog/clickhouse-acquires-langfuse-open-source-llm-observability ; https://langfuse.com/blog/announcing-acquisition
- Cost control: layered token budgets (org → tenant → agent → request), token-based not request-based limits, graduated responses (warn → downgrade model/shorten → block), count hidden tokens (tool results, retries, context growth). — Gravitee (vendor) e.g. https://gravitee.io/corpus/gen-657/web-oriented-architecture/llm-gateway-cost-controls.html
- Streaming UX: message = parts array; tool calls have their own state machine (input-streaming → input-available → output-available/error, optional approval); show every tool state, give a stop button, throttle high-frequency updates. — Vercel AI SDK patterns via https://community.vercel.com/t/capturing-tool-calls-and-results-while-streaming-with-the-vercel-ai-sdk/32475/3
- TS vs Python: Mastra, Vercel AI SDK, OpenAI Agents JS, LangGraph.js, Google ADK TS and Claude Agent SDK (TS + Python) make TypeScript viable for product-embedded agents; Python still leads ML-heavy work and ecosystem breadth. — https://blaxel.ai/blog/typescript-vs-python-ai-agents ; https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk (2025-09-29)

**Contested**
- Framework vs hand-rolled loop: Anthropic says understand what's underneath and reduce abstraction in production; vendors push SDKs. Harness assumptions go stale across model generations (Anthropic's harness post notes a context-reset trick needed for Sonnet 4.5 became dead weight on Opus 4.5). — https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents (2025-11-26, via secondary summaries)
- Managed eval SaaS vs OSS self-host (Langfuse needs Postgres+ClickHouse+Redis+S3).

**Recommendation for us**
- TypeScript agent runtime in the monorepo. Customer chat = routed workflow (intent classify → scoped sub-flows: FAQ/RAG, order lookup/modify, lead capture, handoff); a free agent loop only for open-ended paths. Irreversible actions (refunds, order changes) go behind approval/human handoff in code, not prompts.
- Namespaced tools (`orders_get`, `crm_contact_upsert`), concise/detailed response formats, pagination, errors that say what to do next.
- Cache the static prefix (tools + system + tenant knowledge) with 1-hour TTL per tenant; per-request context after the breakpoint.
- Langfuse for traces + promptfoo in CI on a golden set per intent + LLM-as-judge on sampled traces. Per-tenant token budgets enforced before each step; cheap model by default, escalate on confidence.
- Stream via SSE with tool-state parts; persist every run step for replay, audit and evals.

---

## 4. Frontend for fast dashboards (2026)

**Consensus**
- For an authenticated, non-SEO dashboard, a client-first app (Vite + React + TanStack Router/Query, or TanStack Start in SPA mode) is the lightest fit; Next.js (16, 2025-10-21, Turbopack default, `proxy.ts`, Cache Components) is server-first and optimized for Vercel; React Router v7 framework mode is the "pragmatic middle" (v8 shipped 2026-06-17 under open governance; RSC mode still unstable). — https://tanstack.com/start/latest/docs/framework/react/comparison ; https://blog.logrocket.com/tanstack-start-vs-next-js-choosing-the-right-full-stack-react-framework/ ; https://nextjs.org/16 ; https://remix.run/blog/react-router-v8.md
- TanStack Start 1.0 declared stable 2026-10-13 (RC since 2025-09-23). — https://tanstack.com/blog/announcing-tanstack-start-v1
- Auth: RFC 10017 / BCP 212 "OAuth 2.0 for Browser-Based Applications" (Aug 2026) ranks BFF > token-mediating backend > browser-based client, and says the browser-based pattern is not recommended for business/personal-data apps. Practical pattern: opaque session cookie (httpOnly, Secure, SameSite) + CSRF protection, or short-lived access token in memory + rotating refresh token in httpOnly cookie; never localStorage. — https://www.rfc-editor.org/rfc/rfc10017.txt ; https://curity.io/resources/learn/spa-best-practices/ ; https://oneuptime.com/blog/post/2026-08-10-oidc-browser-token-storage-bff/view
- shadcn/ui: Tailwind v4 is the baseline; Base UI support added Jan 2026, CLI v4 (Mar 2026) removed `--style/--base-color` flags, and new projects default to Base UI as of July 2026 (Radix still supported, every component ships for both). — https://medium.com/@nakranirakesh/shadcn-ui-march-2026-update-cli-v4-ai-agent-skills-and-design-system-presets-d30cf200b0e9 ; https://releases.sh/shadcn/shadcn-ui/highlights (unverified: check ui.shadcn.com changelog)
- Performance budgets commonly used: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at p75 field; initial JS ≤ ~200 KB gzipped, per-route chunks ≤ ~50 KB; Lighthouse CI + bundle-size check on each PR (fail at >5% over budget). — https://www.techinterview.org/post/3233475413/frontend-performance-budgets-real-user-monitoring/ ; https://mubaidr.js.org/blog/20-core-web-vitals-2026-optimization

**Contested**
- Claims of stricter 2026 CWV thresholds (LCP 2.0 s / INP 150 ms) are not confirmed by Google docs.
- Base UI vs Radix for new shadcn projects; RSC-based frameworks for dashboards (most 2026 posts say extra machinery for no SEO benefit).

**Recommendation for us**
- Vite + React 19 + TanStack Router + Query (Start only if you want server functions). No RSC. Route-level code splitting, virtualized inbox lists, optimistic updates.
- httpOnly session cookie on the API origin, SameSite=Lax + CSRF token on mutations; no tokens in JS. Bearer only for the public API/webhooks.
- Tailwind v4 + shadcn (Base UI) with locked design tokens; size-limit + Lighthouse CI in PRs; RUM for p75 INP/LCP.

---

## 5. Realtime at scale

**Consensus**
- Socket.IO behind multiple nodes needs sticky sessions because of the long-polling handshake; set `transports: ['websocket']` to drop stickiness (at the cost of restrictive-network fallback) and use the Redis/Redis Streams/Postgres adapter for cross-node broadcast. Raw `ws`/uWebSockets.js need your own heartbeat (~30 s ping, terminate on missed pong) and pub/sub. — https://socket.io/docs/v4/using-multiple-nodes/ ; https://www.videosdk.live/developer-hub/websocket/websocket-scale
- SSE is the simplest for server→client only (plain HTTP, stateless scaling, HTTP/2 for connection limits); WebSockets when you need client→server at high frequency (typing, presence). — same sources.
- Cloudflare proxies WebSockets on all plans, inspects only the upgrade request with WAF, closes idle connections (community/third-party say 100 s; Enterprise can adjust); use app-level heartbeats ≤45 s (browser tab throttling), enable session affinity on load-balanced origins, expect deploys to drop sockets. — https://developers.cloudflare.com/network/websockets/ ; https://community.cloudflare.com/t/cloudflare-websocket-timeout/5865
- Managed options: Cloudflare Durable Objects with Hibernation API (accept via `ctx.acceptWebSocket`, persist per-socket state in 16 KB attachments, batch frames every 50–100 ms, deploys disconnect everyone; no built-in presence/history) vs Ably/Pusher (presence, history, SLAs, per-message pricing). — https://developers.cloudflare.com/durable-objects/best-practices/websockets/ ; https://ably.com/compare/cloudflare-durable-objects-vs-pusher

**Contested**
- Build on Durable Objects (cheap idle, full control, DIY presence) vs buy Ably/Pusher vs run Socket.IO + Redis yourself; Socket.IO's overhead vs raw `ws` matters only at very high fan-out.

**Recommendation for us**
- Phase 1: SSE for inbox/agent streaming (one stream per workspace) fed by Redis pub/sub from workers; a small websocket-only Socket.IO surface for typing/presence if needed (Redis adapter, no stickiness).
- Separate realtime deployable; 30 s heartbeat; resume via `Last-Event-ID` so Cloudflare/deploy drops are invisible. Revisit Ably/Durable Objects only if connections outgrow a small Node tier.

---

## 6. Backend framework, API contracts, ORM

**Consensus**
- Positioning: NestJS = opinionated DI/modules (enterprise), Fastify = fast, schema-validated, minimal opinions (most greenfield REST), Hono = Web-standard, edge-first; NestJS can run on the Fastify adapter. Encore's benchmarks are vendor-biased. — https://encore.dev/articles/nestjs-vs-fastify-vs-hono ; https://www.pkgpulse.com/guides/nestjs-vs-fastify-2026
- Contracts: tRPC is the TS-monorepo default but TS-only and no OpenAPI without adapters; ts-rest is contract-first REST with OpenAPI; oRPC v1 (Dec 2025) combines tRPC-style typing with native OpenAPI and runs on Node/Bun/Workers; OpenAPI codegen is what public/partner APIs still use. — https://infoq.com/news/2025/12/orpc-v1-typesafe/ ; https://www.pkgpulse.com/guides/trpc-v11-vs-ts-rest-2026 ; https://catalins.tech/public-api-trpc/
- ORM: Prisma 7 (2025-11-19) is Rust-free, ESM-first, driver adapters required (Prisma 8 RC as of Oct 2026); Drizzle 0.45.x stable with a 1.0 RC track (unverified), first-class `pgPolicy`/`withRLS`/role entities and Neon `crudPolicy`/Supabase helpers; both support RLS via `set_config` in a transaction (Prisma via `$extends` + `$transaction`). — https://www.prisma.io/blog/announcing-prisma-orm-7-0-0 ; https://orm.drizzle.team/docs/rls ; https://atlasgo.io/guides/orms/prisma/row-level-security

**Contested**
- Whether NestJS's structure helps or hurts AI-written code: no sources address agents directly. Inference from the Fowler harness essay: strong typing and clear module boundaries improve "harnessability", decorators/DI magic increase surface for subtle mistakes. — https://martinfowler.com/articles/harness-engineering.html (2026-04-02)
- Drizzle vs Prisma: Drizzle's SQL-first style fits RLS/`set_config` naturally; Prisma has more guided migrations and broader DB support. Mostly blog opinion.

**Recommendation for us**
- Fastify (or Hono on Node) with a thin explicit module layout, not NestJS: less framework magic for agents to get wrong; enforce structure with lint/ArchUnit-style tests instead of decorators.
- oRPC or ts-rest with Zod as the single contract: typed dashboard client plus generated OpenAPI for webhooks/partners; schema validation is a free guardrail on agent-written handlers.
- Drizzle: schema and RLS policies in code (`withRLS`, `pgPolicy`), explicit SQL, migrations reviewed as plain SQL diffs.

---

## 7. Operating a repo where coding agents write most code

**Consensus**
- AGENTS.md/CLAUDE.md: short, only what the agent cannot infer (commands, test runner, style deltas, repo etiquette, gotchas); nested per-directory files override root; Codex caps at 32 KiB; Claude Code advises pruning ("would removing this cause a mistake?") and moving occasional knowledge to skills. — https://learn.chatgpt.com/docs/agent-configuration/agents-md ; https://code.claude.com/docs/en/best-practices ; GitHub Copilot coding agent reads AGENTS.md/CLAUDE.md (2025-08-28): https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions
- Verification is the lever: give agents a runnable pass/fail (tests, typecheck, lint, screenshot diff); use deterministic hooks (not prose) for things that must always happen; explore → plan → implement → commit; fresh-context adversarial review subagent before "done"; writer/reviewer split. — Claude Code best practices above.
- Harness engineering (Böckeler/Fowler, 2026-04-02): guides (AGENTS.md, skills, codemods) + sensors (linters with fix instructions, type checks, fitness functions, mutation tests, LLM review); fast deterministic checks pre-merge, expensive/inferential ones post-merge; humans improve the harness when an issue recurs. — https://martinfowler.com/articles/harness-engineering.html
- CI/branch gates: no direct push to main, PR + ≥1 human approval, required typecheck/lint/tests/security scan, AI code review as a first pass (Codex "Code Review Rules" section), coverage/dead-code drift sensors. — https://radar.firstaimovers.com/harness-engineering-pr-quality-gates-european-companies-2026 ; https://developer.vonage.com/en/blog/beyond-vibe-coding-best-practices-2026
- Eval-driven development for the LLM product: golden datasets per intent, CI eval gate (promptfoo), trace-based evals in production. — Anthropic tools post; Braintrust/promptfoo above.
- Long-running agent work: initializer/feature-list/progress-file pattern, one feature per session, git as memory. — Anthropic harness post (2025-11-26, via https://www.beri.net/learning/anthropic-effective-harnesses-long-running-agents)

**Contested**
- How much to trust AI review as a merge gate (inferential, non-deterministic); whether behaviour correctness can be harnessed yet (Fowler essay: not well).

**Recommendation for us**
- Root `AGENTS.md` (≤ ~150 lines), `CLAUDE.md` imports it; nested files only for the agent runtime and DB layer. Encode invariants as checks, not prose: ESLint rules (no DB access outside `withTenant`, no LLM calls outside the gateway), branded tenant-ID types, dependency tests, migration lint.
- PR template: tests, verification commands with output, "tenant-isolation impact" line. Required CI: typecheck, lint, unit + integration against Postgres with RLS on, promptfoo evals on prompt/tool changes, size-limit, secret scan. One human approval; agent PRs small and single-purpose.
- Loop: writer agent → fresh-context reviewer agent (diff-only, correctness gaps only) → human. Hook blocks edits to `migrations/` and `policies/` without a label. Weekly: prune AGENTS.md; turn recurring review comments into lint rules or skills.
