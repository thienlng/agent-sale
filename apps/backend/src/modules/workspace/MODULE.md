# workspace — GOLDEN MODULE (copy this shape)

**Purpose:** the tenant root. Creating a workspace creates the tenant; everything else hangs off `workspace_id`.

**Owned tables:** `workspaces` (incl. profile columns and `account_id`, 0028), `members`, `workspace_assets` (private logo, bytea) — migrations 0017 (schema in `packages/db/src/schema/workspace.ts`).

**Public API (`api/`):**

- `WORKSPACE_FACADE` → `WorkspaceFacade.getById(workspaceId)`, `createWorkspace({ name, industry, ownerUserId, accountId? })` (the business goes under an account the owner owns, resolved by the `account` facade, ADR-012), `findMembership`, `listMemberships`, `listMembers`, `joinMember`, `changeMemberRole`, `removeMember`, `countActive`, `accountOf(workspaceId)` (the owning account id, `null` before the account backfill; used by billing)
- HTTP: `/workspace/profile` (GET any member, PATCH `settings.manage`), `/workspace/logo` (GET any member; PUT/DELETE `settings.manage`)
- Events: `workspace.workspace.created.v1` (see `packages/contracts/src/workspace/workspace.events.ts`)

**Events consumed:** none.

**Invariants:**

- A workspace name is 1–120 chars after trim; industry is required (drives the vertical pack, docs/17).
- The owner is always a member with role `owner`; a workspace has exactly one owner, whose membership cannot be removed or given another role.
- Roles are `owner | admin | sales | care | analyst` (capabilities per role: `ROLE_CAPABILITIES` in contracts, checked by the auth guard). Removed members keep their row (`status = removed`, `removed_at`) and can rejoin.
- **Profile and logo (ADM-02):** the profile is versioned (`expectedVersion`, row lock; stale = 409) and audited. The logo is `image/png` or `image/jpeg`, ≤ 1 MiB, square, 128–2048 px (720 recommended), validated from the image bytes (not the declared type) before anything is written; uploading the same bytes again is a no-op. It lives in a tenant RLS table and is served only through the authorised route with `nosniff`, a restrictive CSP and `ETag`/304 — there is no public URL. `businessServices` and `productDescription` are **deprecated** (T-144): the dashboard no longer edits them and the AI never reads them (business facts live in each bot's profile, T-137); they stay in the API and the schema for backward compatibility.
- `joinMember` takes the plan's seat limit and checks it atomically (advisory lock per workspace); it returns `SeatLimitError` when full.
- Deleting is soft (`deleted_at`); hard delete is a scheduled job after 30 days (docs/09 §10).

**Do not:** read `members` from other modules (use the facade); put HTTP or Drizzle types in `domain/`.

**Test:** `pnpm --filter @agent-sales/backend test -- workspace`

Shape: `api/` (contract) · `domain/` (pure) · `application/commands|queries` (handlers) · `infrastructure/persistence` (Drizzle + in-memory) · `interface/http` (thin controller) · `__tests__/` (factories, facade contract test).
