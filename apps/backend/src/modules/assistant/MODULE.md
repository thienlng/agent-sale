# assistant

**Purpose:** the owner assistant "Thỏ Rapiz" (ADR-021, T-170): an account owner's private chat threads, the runs that answer them and their steps. Owner-only and account-scoped, not business-scoped.

**Owned tables:** `assistant_threads`, `assistant_messages`, `assistant_runs`, `assistant_run_steps` (migration 0053; schema in `packages/db/src/schema/assistant.ts`). Every row carries `account_id`; RLS reads `app.account_id`, set by `withAccount`. `assistant_messages.search` (generated tsvector, GIN + trigram indexes) exists only in SQL and is queried with `sql`.

**Public API (`api/`):**
- `ASSISTANT_FACADE` → `AssistantFacade.listThreads | createThread | updateThread | listMessages | sendMessage | getRun` (actor = user + current business). No other module consumes it yet.
- HTTP (`assistantRoutes`, all `@WorkspaceScoped()`): `GET/POST /assistant/threads`, `PATCH /assistant/threads/{threadId}`, `GET/POST /assistant/threads/{threadId}/messages`, `GET /assistant/runs/{runId}`. `POST …/messages` answers 500 until the chat turn lands (T-170 task 6).
- Events: none.

**Depends on:** `account` (`listForUser`: owner role), `workspace` (`accountOf`, `listMemberships` for the prompt's business list), `ai` (`AI_LLM_GATEWAY`, chat turns).

**Invariants:**
- Owner-only: every facade call starts with `resolveOwnerScope` (`application/owner-access.ts`); the caller must be an active `owner` of the account that owns the current business, else 403 `FORBIDDEN` (billing members and staff are refused).
- Account scope AND owner: every repository method runs in one `withAccount` transaction and filters by `account_id` and `owner_user_id`; a thread or run of another owner (even of the same account) is 404. Methods taking a `threadId`/`runId` verify ownership in the same transaction first, because the `thread_id` foreign keys alone do not carry the owner.
- Tool rows (`role = 'tool'`) never leave the backend; message DTOs carry `user`, `assistant`, `event` only.
- A thread's system prompt (`assistant@1`) is frozen at creation (owner name, the account's businesses as `- <name> (<industry>)`, today's date in Asia/Ho_Chi_Minh), so it stays byte-stable for prompt caching.
- No business data is stored: the assistant reads other modules through their facades at answer time; only the conversation and run traces are kept.
- One running run per owner (younger than 3 min); a run id is the client `turnId`, so a retried turn is a duplicate, not a second run.

**Do not:** read other modules' tables; use `withTenant` for assistant tables; put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`.

**Test:** `pnpm --filter @agent-sales/backend test -- assistant`; integration: `test/assistant.integration.spec.ts`.
