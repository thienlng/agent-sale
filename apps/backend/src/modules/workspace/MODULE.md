# workspace — GOLDEN MODULE (copy this shape)

**Purpose:** the tenant root. Creating a workspace creates the tenant; everything else hangs off `workspace_id`.

**Owned tables:** `workspaces` (incl. profile columns and `account_id`, 0028), `members`, `workspace_assets` (private logo, bytea) — migrations 0017 (schema in `packages/db/src/schema/workspace.ts`).

**Public API (`api/`):**

- `WORKSPACE_FACADE` → `WorkspaceFacade.getById(workspaceId)`, `createWorkspace({ name, industry, ownerUserId, accountId?, owner? })` (`owner` = the signup user's name/email/phone, carried into `account.account.created.v1`) (the business goes under an account the owner owns, resolved by the `account` facade, ADR-012), `findMembership`, `listMemberships`, `listMembers`, `joinMember`, `changeMemberRole`, `removeMember`, `countActive`, `accountOf(workspaceId)` (the owning account id, `null` before the account backfill; used by billing), `listByAccounts(accountIds)` (businesses of these accounts with member counts, platform admin only), `listActiveIds({ afterId, limit })` (ids of active businesses, oldest id first; worker scans such as the Business Brain morning briefing)
- `isActive(workspaceId)`: false once the owner deleted the business (the billing gate, ADR-032)
- `WORKSPACE_LIFECYCLE` → `WorkspaceLifecycle.onDeletionRequested(name, handler)`: modules above `workspace` react to a deleted business (`channel`, `integration`); handlers run after the commit, failures are logged and do not fail the request; the purge runs them again before deleting rows, so handlers must be idempotent
- `WORKSPACE_PURGE_RUNNER` → `tick()`: run by the `worker` every minute (scan every 5 minutes, ≤ 3 businesses; a failing one backs off 5 min × 2^(n−1), ≤ 24 h)
- HTTP: `/workspace/profile` (GET any member, PATCH `settings.manage`), `/workspace/logo` (GET any member; PUT/DELETE `settings.manage`); business deletion (not workspace-scoped, owner only): `POST /workspaces/{workspaceId}/deletion` `{confirmName}`, `POST /workspaces/{workspaceId}/restore`, `GET /workspaces/deleted`
- Events: `workspace.workspace.created.v1`, `workspace.workspace.deletion_requested.v1`, `workspace.workspace.restored.v1`, `workspace.workspace.purged.v1` (platform event, no workspace on the outbox row) (see `packages/contracts/src/workspace/workspace.events.ts`)

**Events consumed:** none.

**Invariants:**

- A workspace name is 1–120 chars after trim; industry is required (drives the vertical pack, docs/17).
- The owner is always a member with role `owner`; a workspace has exactly one owner, whose membership cannot be removed or given another role.
- Roles are `owner | admin | sales | care | analyst` (capabilities per role: `ROLE_CAPABILITIES` in contracts, checked by the auth guard). Removed members keep their row (`status = removed`, `removed_at`) and can rejoin.
- **Profile and logo (ADM-02):** the profile is versioned (`expectedVersion`, row lock; stale = 409) and audited. The logo is `image/png` or `image/jpeg`, ≤ 1 MiB, square, 128–2048 px (720 recommended), validated from the image bytes (not the declared type) before anything is written; uploading the same bytes again is a no-op. It lives in a tenant RLS table and is served only through the authorised route with `nosniff`, a restrictive CSP and `ETag`/304 — there is no public URL. `businessServices` and `productDescription` are **deprecated** (T-144): the dashboard no longer edits them and the AI never reads them (business facts live in each bot's profile, T-137); they stay in the API and the schema for backward compatibility.
- `joinMember` takes the plan's seat limit and checks it atomically (advisory lock per workspace); it returns `SeatLimitError` when full.
- **Deletion (ADR-032):** owner only, the name typed exactly. `active` → `pending_deletion` (`deleted_at`, `purge_after` = +30 days) → `purging` (claimed by the purge) → `deleted` (tombstone after the purge). Restore before `purge_after` only, decided by one conditional `UPDATE` on the database clock (`WorkspaceRepository.restoreWithinWindow`); the purge claims with the mirror statement, so exactly one wins. A deleted or purging business is invisible to every membership lookup and list. The purge (`application/workspace-purge.runner.ts`, `infrastructure/persistence/workspace-purge.drizzle-store.ts`, as `app_system`) claims the business, re-runs the deletion hooks, deletes rows with `purgeWorkspaceRows` from `@agent-sales/db` (every `workspace_id` table except `audit_events`, `message_usage`, `workspaces`), then the objects under `businessMediaPrefixes(ws)` and `exports/<ws>/` (`infrastructure/storage/s3-business-object-eraser.ts`), then writes the tombstone. A failure keeps the business `purging` with `purge_attempts`, `purge_next_at` (back-off) and `purge_last_error` (error class/SQLSTATE only); from the 5th failure each one is logged at error level (0078).

**Do not:** read `members` from other modules (use the facade); put HTTP or Drizzle types in `domain/`.

**Test:** `pnpm --filter @agent-sales/backend test -- workspace`; HTTP + Postgres: `apps/backend/test/business-deletion.integration.spec.ts`

Shape: `api/` (contract) · `domain/` (pure) · `application/commands|queries` (handlers) · `infrastructure/persistence` (Drizzle + in-memory) · `interface/http` (thin controller) · `__tests__/` (factories, facade contract test).
