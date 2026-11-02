# ADR-023: Owner assistant — account-scoped, self-improving agent with three access lanes

- Status: Proposed
- Date: 2026-11-02
- Decision makers: product owner (Tùng), maintainer (thienlng); drafted by @agent:claude for T-170
- Design: [`docs/superpowers/specs/2026-11-02-owner-assistant-core-design.md`](../superpowers/specs/2026-11-02-owner-assistant-core-design.md)

## Context

The owner asked (2026-11-02) for a personal assistant per account, always present as a chat bubble, that knows the current page and the whole account, guides the owner, fills products and shop data from files, explains why the shop bot answered badly, answers data questions (revenue…), runs scheduled reports and becomes smarter with use, modelled on hermes-agent's self-improvement.

Constraints from the current architecture:

- Tenant isolation is per workspace (ADR-004: `app.workspace_id`, forced RLS). An owner works across several businesses of one account (ADR-012), so the assistant's own data does not fit one workspace.
- ADR-012: paying for a business never grants access; business data needs business membership.
- About 200 HTTP routes are declared with Zod schemas in `packages/contracts` (`allRoutes`); auth, RBAC, validation, audit and outbox live behind them.
- ADR-010/015: Hermes is a private inference pipe with no tools or DB; production uses the OpenAI API.
- hermes-agent is single-user and file-based (one home per process, shell/file tools). Dify's licence (condition 1a) forbids operating its source as a multi-tenant service.

Owner decisions in brainstorming: owners only (no staff); no MCP/ChatGPT/Claude exposure of Rapiz; no sandbox; learn from Hermes (skills, memory, schedules, review); new learned skills need one owner approval, memory and skill patches apply automatically with undo.

## Decision

1. **A new tier-3 module `assistant`** owns threads, messages, proposals, memory, owner/learned skills, the skill ledger, suggestions, runs and run steps. The generic agent harness (loop, 3-tier prompt builder, compaction, tool registry, skill format, safety scanner) moves to `packages/ai-core/src/agent`; the shop bot's reply loop uses the same code with no behaviour change.
2. **Account-scoped tenancy for assistant data.** Assistant tables carry `account_id` and `owner_user_id`. `packages/db` gains `withAccount(accountId, fn)` (transaction-scoped `set_config('app.account_id', …, true)`, same rules as `withTenant`) and an `accountPolicies(table)` template: `app_tenant` sees rows where `account_id = current_setting('app.account_id')`; `app_system` as today for workers. This amends ADR-004. Business data is never copied into assistant tables.
3. **Owners only.** Every assistant entry point (HTTP, SSE, proposal approval, scheduled run preflight) checks an active `owner` membership of the account through the `account` facade. The assistant sees only businesses where that owner is an active member (ADR-012 unchanged).
4. **Three access lanes, no others:**
   - **Route tools:** `RouteContract` gains `assistant: {use: 'read' | 'write' | 'never', when}`; tools are generated from the declarations; an architecture test requires the field on every workspace-scoped route. Reads run in-process through the real HTTP pipeline with a short-lived delegated owner session, sent with `X-Actor: assistant` so changes can be audited as the assistant on behalf of the owner (not audited yet: see Consequences). **Writes are never executed by the model**: they become `assistant_proposals` that the owner approves; approval executes the stored request with the owner's own session.
   - **Read-only SQL lane** (capability 2, own spec): a curated view schema, a dedicated SELECT-only role, multi-business RLS, `READ ONLY` transactions and timeouts.
   - **UI actions and page context:** navigate, spotlight, fill a form draft; pages declare structured context. No screenshots.
5. **No code sandbox.** Reads are sandboxed by Postgres; transforms (imports) are declarative specs applied by our code; charts are rendered by the web app.
6. **Hermes patterns, ported, not run:** frozen 3-tier system prompt with per-turn data on the last user message and a lineage-stable `promptCacheKey`; in-place compaction with soft-archived, searchable rows; accent-insensitive Postgres full-text session search; bounded memory stores with a frozen snapshot; skills with progressive disclosure and provenance (`platform`, `owner`, `learned`, `shadow`); a background review job (memory every 8 owner turns, skills every 10 tool rounds, idle 30 min) restricted to memory/skill tools; an append-only skill ledger with undo; a weekly deterministic curator (stale 30 days, archive 90 days); proactive suggestions (≤ 5 pending). Unlike Hermes defaults, the safety scan is **always on** for memory and skill writes, loops have budgets, and the review runs as a cancellable worker job that never writes to the transcript.
7. **No external exposure**: no MCP server or third-party assistant connector for Rapiz data.

## Options considered

- **Run hermes-agent per owner.** Rejected: one process and file home per user (the cost we want to avoid), shell/file tools, state outside Postgres/RLS, and it contradicts ADR-010 (Hermes has no tools or DB).
- **Unrestricted read-only SQL on all tables.** Rejected: sealed secrets and tokens sit in tables, RLS is single-workspace, raw-schema SQL is error-prone and silently wrong, and an unbounded query can load the shared primary. Kept in a restricted form (curated views, own role) as lane (b).
- **Hand-written tools per feature.** Rejected: coverage drifts as features ship; the route-declaration field plus an architecture test makes coverage mechanical and reuses auth/RBAC/audit.
- **MCP internally.** Rejected: in-process calls are cheaper and simpler; MCP is a cross-process protocol. External MCP exposure was rejected by the owner.
- **Embed Dify.** Rejected: licence condition 1a (no multi-tenant operation of its source), Python stack and its own auth/DB.
- **Container sandbox (E2B-style) for code execution.** Rejected for now: no capability needs arbitrary code; it adds per-session cost.

## Consequences

- Positive: one harness for the shop bot and the assistant (compaction and traces for both); new features become assistant-reachable by declaration; no new write path bypasses auth (assistant-specific audit is a follow-up, see 1b below); personalisation is stored per owner in Postgres with undo and audit.
- Negative: a new tenancy helper and policy template (ADR-004 amendment) and a second RLS predicate to test; the route field adds a small cost to every new route; background reviews and compaction add LLM spend (bounded, metered per account); self-modifying skills need ongoing safety review.
- Exception (T-170, 1a): the owner assistant turn runs synchronously within 90 s, owners only, one turn per owner; it moves off the request with streaming in 1b. Recorded next to the rule in `docs/16-performance-and-scale.md` §2.
- 1b (T-170): route tools, owner-approved proposals, bounded memory, platform skills, auto-compaction and `ui_fill_form` shipped (migration 0057). The turn is still synchronous (the exception above stays until streaming moves the turn off the request); route reads and proposal execution use the owner's own bearer token, held in memory for the request, as the delegated session; the assistant reaches other modules' data only through their declared routes (Fastify `inject` via Nest `HttpAdapterHost`), never their internals. Proposal rows keep the owner's request body, the `before` snapshot and a ≤ 1 000-char result preview (account-scoped, RLS). Owner, learned and shadow skills move to 1c. The `X-Actor: assistant` header is sent but not consumed: an approved change is audited as the approving owner's own request until a follow-up audits assistant-run changes. Details: spec §19.
- Capability 5 (T-174, [spec](../superpowers/specs/2026-11-02-owner-assistant-5-design.md)): the `ai` module records shop-bot turn traces (`ai_run_traces` + `ai_run_steps`, migration 0062, forced RLS, redacted excerpts and allowlisted step details, best-effort, purged after 30 days by the `agent` process) and serves them as `read` routes; the bot doctor is a platform skill over the 1b route tools, no new tool or process. A route may narrow the body the assistant drafts (`RouteAssistantUse.body`); a contract test makes a secret-bearing body a `write` only through such a narrowing, so `POST /bots/{botId}/actions` drafts a disabled action without its secret, and the owner types the key in the form. Pasted secrets are masked before the owner's message is stored or reaches the model.
- Follow-ups: specs for the SQL lane, schedules + `notification`, import, bot doctor, autofill; update `docs/04-system-architecture.md` and `docs/ARCHITECTURE.md` §3 (module row) in the implementation PR; add the assistant allowance to `docs/08-billing-quota-credit.md`; performance budgets for the bubble in `docs/16`.
