# billing

**Purpose:** what a workspace is entitled to: its plan, operator overrides and the resolved limits other modules ask for (seats today; credits, invoices and payments follow in T-059/T-060).

**Owned tables:** `plans` (global, app_system only), `subscriptions`, `workspace_entitlement_overrides` (tenant, forced RLS) — migration 0015; schema in `packages/db/src/schema/billing.ts`.

**Public API (`api/`):**

- `BILLING_FACADE` → `entitlements(workspaceId)` → `EntitlementsDto` (e.g. `members.max`). HTTP: `GET /billing/entitlements` (any member).
- Events: none yet.

**Events consumed:** none.

**Invariants:**

- Entitlements = the plan's limits overlaid with unexpired overrides. `null` means unlimited; a key that is missing means 0 (so a new limit is closed until a plan opens it).
- Plans are seeded (`free`, `sales_smart`, `sales_pro`, `sales_neo`); a workspace with no subscription is on `free` (1 member seat).
- Plan rows are cached for 60 s per process; a plan change by the operator CLI (`pnpm --filter @agent-sales/backend workspace-plan set|show <owner-email> <plan> [months]`) is visible after that.
- Callers never read these tables; they ask the facade. Enforcement belongs to the module that owns the thing being limited (team checks seats), never here.

**Do not:** read other modules' tables; put HTTP/Drizzle types in `domain/`; read `plans` with the tenant connection.

**Test:** `pnpm --filter @agent-sales/backend test -- billing` and `test/team.integration.spec.ts` (seat limits).
