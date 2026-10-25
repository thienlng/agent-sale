# action

**Purpose:** HTTP APIs ("actions") a shop owner declares and the bot may call mid-conversation — order lookup, ERP stock, bookings. The model decides _when_ to call; this module decides _whether and how_ (docs/actions.md, T-055).

**Owned tables:** `bot_actions`, `action_runs`, `action_pending` (migration 0015; tenant, forced RLS; schema in `packages/db/src/schema/action.ts`).

**Public API (`api/`):** `ACTION_FACADE` → `list`, `get`, `create`, `update`, `remove`, `test`, `listForBot` (enabled actions shaped for the prompt), `invoke`, `getPending`, `setPending`, `clearPending`. No HTTP of its own: the `bot` module serves `/bots/{botId}/actions` (+ `/{id}/test`) after checking the bot belongs to the workspace. `invoke`, the pending store and a real `test` call arrive with the action runner (T-055 task 3); until then `test` returns `network` and the others throw.

**Events consumed:** none.

**Invariants:**

- The URL is HTTPS; every `{placeholder}` has a `path` param of the same name; param names are unique (`ActionInput` in `packages/contracts/src/action`).
- The auth secret is sealed with `SecretBox` on write, never returned (DTOs only expose `hasSecret`), never logged, never sent to the model. On update an absent `authSecret` keeps it, `''` clears it, and switching auth to `none` drops it.
- `action_runs` stores no arguments and no response bodies (PII).
- Callers must have verified `botId` belongs to the workspace; RLS still guarantees no cross-tenant read.

**Do not:** read other modules' tables; put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`; let the model reach the network (only the server-side executor does).

**Test:** `pnpm --filter @agent-sales/backend test -- action`
