# assistant

**Purpose:** the owner assistant "Thỏ Rapiz" (ADR-021, T-170): an account owner's private chat threads, the runs that answer them and their steps. Owner-only and account-scoped, not business-scoped.

**Owned tables:** `assistant_threads`, `assistant_messages`, `assistant_runs`, `assistant_run_steps` (migration 0053; schema in `packages/db/src/schema/assistant.ts`). Every row carries `account_id`; RLS reads `app.account_id`, set by `withAccount`. `assistant_messages.search` (generated tsvector, GIN + trigram indexes) exists only in SQL and is queried with `sql`.

**Public API (`api/`):**

- `ASSISTANT_FACADE` → `AssistantFacade.listThreads | createThread | updateThread | listMessages | sendMessage | getRun` (actor = user + current business). No other module consumes it yet.
- HTTP (`assistantRoutes`, all `@WorkspaceScoped()`): `GET/POST /assistant/threads`, `PATCH /assistant/threads/{threadId}`, `GET/POST /assistant/threads/{threadId}/messages`, `GET /assistant/runs/{runId}`. `POST …/messages` runs one chat turn (below) and answers 200 with the turn's visible messages and its run; 409 `CONFLICT` (`details.reason = assistant_busy`) while another run of the owner is running, or (`turn_id_taken`) when the `turnId` is another owner's run or a run of another thread; 503 `AI_UNAVAILABLE` when no model serves the `pro` tier.
- Events: none.

**Depends on:** `account` (`listForUser`: owner role), `workspace` (`accountOf`, `listMemberships` for the prompt's business list), `ai` (`AI_LLM_GATEWAY` for chat turns, `isAiNotConfiguredError` to answer 503).

**Chat turn (`application/chat-turn.service.ts`):** `startRun` (id = `turnId`, tier `pro`, `assistant@1`) → store the owner's text (raw, with its `pageContext`) → history = active messages (`event` rows as `[event] …` user messages); only the last user message is sent as `buildTurnMessage` (`<page_context>` JSON, `<current_time>` HH:mm in Asia/Ho_Chi_Minh, then the text) → `runAgentLoop` on `AI_LLM_GATEWAY`, at most 25 rounds and 90 s, 60 s per model call, `promptCacheKey = asst:<owner>:<thread>` → store the tool exchange (hidden) and the answer with the turn's `uiActions` → `finishRun` (usage, rounds = model calls, latency, provider/model). Steps are written as they happen (kind, tool name, ok, ms; never arguments or results). No answer text, or an outcome other than `done`, gives the fallback reply; a model error gives the fallback reply too, with the run `failed` (`guardrail = model_error`). An untitled thread takes the first 60 characters of its first message as its title. Logs carry the run id, tool name and error class only.

**Core tools (`application/core-tools.ts`, results ≤ 8 000 chars):** `session_search({query, limit≤10=3})` over the owner's earlier user/assistant messages; `ui_navigate({to})` only for `/app` or `/app/…` without a `..` segment (ruling R6), else `invalid_path`; `ui_spotlight({target, hint})` only for a target listed in the page context, else `unknown_target`. Both UI tools add to the answer's `uiActions`; none of them changes data.

**Web client:** `apps/web/src/features/assistant` (launcher in `routes/app.tsx`, owners only; panel and `assistant` i18n namespace lazy-loaded; steps polled from `GET /assistant/runs/{runId}` every second while a turn runs; `ui_navigate` re-checked client-side by `safeAppPath`). Not in 1a: proposals and any write tool, `ui_fill_form`, route-derived tools, memory, skills, compaction, SSE streaming (spec §18).

**Invariants:**

- Owner-only: every facade call starts with `resolveOwnerScope` (`application/owner-access.ts`); the caller must be an active `owner` of the account that owns the current business, else 403 `FORBIDDEN` (billing members and staff are refused).
- Account scope AND owner: every repository method runs in one `withAccount` transaction and filters by `account_id` and `owner_user_id`; a thread or run of another owner (even of the same account) is 404. Methods taking a `threadId`/`runId` verify ownership in the same transaction first, because the `thread_id` foreign keys alone do not carry the owner.
- Tool rows (`role = 'tool'`), and assistant rows that only requested tools, never leave the backend; message DTOs carry `user`, `assistant`, `event` only.
- A thread's system prompt (`assistant@1`) is frozen at creation (owner name, the account's businesses as `- <name> (<industry>)`, today's date in Asia/Ho_Chi_Minh), so it stays byte-stable for prompt caching.
- No business data is stored: the assistant reads other modules through their facades at answer time; only the conversation and run traces are kept.
- One running run per owner (younger than 3 min); a run id is the client `turnId`, so a retried turn is a duplicate, not a second run.

**Do not:** read other modules' tables; use `withTenant` for assistant tables; put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`.

**Test:** `pnpm --filter @agent-sales/backend test -- assistant`; integration: `test/assistant.integration.spec.ts`.
