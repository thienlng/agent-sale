# workspace — GOLDEN MODULE (copy this shape)

**Purpose:** the tenant root. Creating a workspace creates the tenant; everything else hangs off `workspace_id`.

**Owned tables:** `workspaces`, `members` (schema in `packages/db/src/schema/workspace.ts`).

**Public API (`api/`):**

- `WORKSPACE_FACADE` → `WorkspaceFacade.getById(workspaceId)`, `createWorkspace({ name, industry, ownerUserId })`, `findMembership`, `listMemberships`, `listMembers`, `joinMember`, `changeMemberRole`, `removeMember`
- Events: `workspace.workspace.created.v1` (see `packages/contracts/src/workspace/workspace.events.ts`)

**Events consumed:** none.

**Invariants:**

- A workspace name is 1–120 chars after trim; industry is required (drives the vertical pack, docs/17).
- The owner is always a member with role `owner`; a workspace has exactly one owner, whose membership cannot be removed or given another role.
- Roles are `owner | admin | sales | care | analyst` (capabilities per role: `ROLE_CAPABILITIES` in contracts, checked by the auth guard). Removed members keep their row (`status = removed`, `removed_at`) and can rejoin.
- Deleting is soft (`deleted_at`); hard delete is a scheduled job after 30 days (docs/09 §10).

**Do not:** read `members` from other modules (use the facade); put HTTP or Drizzle types in `domain/`.

**Test:** `pnpm --filter @agent-sales/backend test -- workspace`

Shape: `api/` (contract) · `domain/` (pure) · `application/commands|queries` (handlers) · `infrastructure/persistence` (Drizzle + in-memory) · `interface/http` (thin controller) · `__tests__/` (factories, facade contract test).
