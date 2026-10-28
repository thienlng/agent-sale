# billing

**Purpose:** what a business is entitled to (its account's plan, operator overrides, the resolved limits other modules ask for) and the account's AI-message meter (T-091, ADR-012 §5). Credits, invoices and payments follow in T-059/T-060.

**Owned tables:** `plans` (global, app_system only), `subscriptions`, `workspace_entitlement_overrides` (tenant, forced RLS) — migration 0015; `account_subscriptions`, `account_entitlement_overrides`, `message_usage` (app_system only, no tenant grant) — migration 0031; schema in `packages/db/src/schema/billing.ts`.

**Public API (`api/`):**

- `BILLING_FACADE` → `entitlements(workspaceId)` → `EntitlementsDto` (e.g. `members.max`). HTTP: `GET /billing/entitlements` (any member).
- `usage(workspaceId)` → `MessageUsageDto` (used / limit / cycle of the account's allowance). HTTP: `GET /billing/usage` (any member).
- `reserveReply(workspaceId, { idempotencyKey, conversationId, botId })` → `ReserveOutcome`, then `captureReply` (delivered) or `releaseReply` (not delivered). Used by the conversation module around every AI reply.
- Events: none yet.

**Events consumed:** none.

**Depends on:** `workspace` facade (`accountOf`) to find the account of a business.

**Invariants:**

- The effective subscription of a business is its account's (`account_subscriptions`); until the backfill copied one, the business's own `subscriptions` row; else `free`. Account overrides apply first, business overrides last.
- The AI-message allowance (`ai.included_messages`) is counted per account per cycle across all its businesses. A plan without the key allows 0 replies. Cycles start at the account subscription's `cycle_anchor` (free: a fixed anchor at 00:00 Vietnam time) and last `periodDays` days.
- One row per reply in `message_usage`, keyed by `(workspace_id, outbound idempotency key)`: retries reuse the row, so a reply is counted once. Reserve takes a per-account advisory lock, so concurrent replies never exceed the allowance. A `reserved` row older than 15 min no longer holds allowance (its process died before deciding).
- A business without an account (before the account backfill) is not metered.

- Entitlements = the plan's limits overlaid with unexpired overrides. `null` means unlimited; a key that is missing means 0 (so a new limit is closed until a plan opens it).
- Plans are seeded (`free`, `sales_smart`, `sales_pro`, `sales_neo`); a workspace with no subscription is on `free` (1 member seat).
- Plan rows are cached for 60 s per process; a plan change by the operator CLI (`pnpm --filter @agent-sales/backend workspace-plan set|show <owner-email> <plan> [months]`) is visible after that.
- A workspace can only read its `subscriptions` and overrides (`app_tenant` has select only, migration 0019); plan changes and overrides are operator writes through `app_system`.
- Shops created before billing carry a `members.max = null` override (`grandfathered…`, migration 0020) instead of falling to the free plan's single seat; remove it when the shop gets a plan.
- Callers never read these tables; they ask the facade. Enforcement belongs to the module that owns the thing being limited (team checks seats), never here.

**Do not:** read other modules' tables; put HTTP/Drizzle types in `domain/`; read `plans` with the tenant connection.

**Test:** `pnpm --filter @agent-sales/backend test -- billing`, `test/team.integration.spec.ts` (seat limits), `test/billing-usage.integration.spec.ts` (message allowance) and `packages/db/src/account-billing.integration.test.ts` (migration 0031 and the subscription backfill).
