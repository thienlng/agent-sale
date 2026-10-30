# account

**Purpose:** the commercial owner of one or more businesses (ADR-012). A business is a workspace; the account is who owns and (from T-091) pays for it.

**Owned tables:** `accounts`, `account_members` — global, no `workspace_id`, `app_system` only (migration 0028; schema in `packages/db/src/schema/account.ts`). Also the meaning of `workspaces.account_id`, which the `workspace` module writes.

**Public API (`api/`):**

- `ACCOUNT_FACADE` → `AccountFacade.resolveForNewBusiness({ userId, accountId?, businessName })`, used by `workspace` when a business is created (signup and `POST /workspaces`)
- `AccountFacade.listForUser(userId)` (accounts the user owns or bills for) and `namesOf(accountIds)` (names for grouping businesses), used by `identity` for `GET /bootstrap` (T-079)
- HTTP: none yet (account screens come with T-091/T-092)
- Events: none

**Events consumed:** none.

**Invariants:**

- A new business goes under an account the caller **owns**: the requested one (`NOT_FOUND` if not owned, so existence does not leak), else the caller's only owned account, else a new account; owning several without choosing is `VALIDATION_FAILED`.
- Account roles are `owner | billing`. **Paying grants no business access**: business data still needs an active `members` row (ADR-012 §2).
- Every repository query is filtered by the authenticated user; the tenant role has no grant on the tables.
- Backfill of existing workspaces: operator CLI `account-backfill [--dry-run]` (ADR-012 §8).

**Do not:** read other modules' tables; put HTTP/Drizzle types in `domain/`; let account membership imply business membership.

**Test:** `pnpm --filter @agent-sales/backend test -- account`
