# action

**Purpose:** HTTP APIs ("actions") a shop owner declares and the bot may call mid-conversation — order lookup, ERP stock, bookings. The model decides _when_ to call; this module decides _whether and how_ (docs/actions.md, T-055).

**Owned tables:** `bot_actions`, `action_runs`, `action_pending` (migration 0015; tenant, forced RLS; schema in `packages/db/src/schema/action.ts`).

**Public API (`api/`):** `ACTION_FACADE` → `list`, `get`, `create`, `update`, `remove`, `test`, `listForBot` (enabled actions shaped for the prompt), `invoke`, `getPending`, `setPending`, `clearPending`, `consumePending` (atomic take for confirmations). No HTTP of its own: the `bot` module serves `/bots/{botId}/actions` (+ `/{id}/test`) after checking the bot belongs to the workspace.

**Executor (T-055 task 3):** `application/action-runner.ts` validates args, builds the request (`domain/build-request.ts`), calls `domain/safe-http.ts` and trims the response to the declared fields of the matching status (`domain/trim-response.ts`; an undeclared status is `bad_status`). `invoke` returns `not_found` (unknown or other bot's action) / `disabled` before any call, else an `ActionOutcome`; every executed call is one `action_runs` row (`test` = `is_test`, works on disabled actions). The pending confirmation (`setPending`/`getPending`/`clearPending`) is one row per conversation with a 10 min TTL; a set replaces, expired reads as null. `ACTION_DEV_ALLOW_HTTP_HOSTS` (dev only, ignored in production) lets QA hit a plain-http fake shop.

**Events consumed:** none.

**Invariants:**

- The URL is HTTPS; every `{placeholder}` has a `path` param of the same name; param names are unique (`ActionInput` in `packages/contracts/src/action`).
- The auth secret is sealed with `SecretBox` on write, never returned (DTOs only expose `hasSecret`), never logged, never sent to the model. On update an absent `authSecret` keeps it, `''` clears it, and switching auth to `none` drops it.
- `action_runs` stores no arguments and no response bodies (PII).
- Callers must have verified `botId` belongs to the workspace; RLS still guarantees no cross-tenant read.

**Do not:** read other modules' tables; put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`; let the model reach the network (only the server-side executor does).

**Test:** `pnpm --filter @agent-sales/backend test -- action`
