# billing

**Purpose:** what a business is entitled to (its account's plan, operator overrides, the resolved limits other modules ask for) and the account's AI-message meter (T-091, ADR-012 §5). Since ADR-021 it also owns the platform side of selling: the versioned plan catalog, billing settings (trial, lifecycle, bank account), the signup trial, the subscription lifecycle and manual VietQR payments. Credits and invoices follow in T-059/T-060.

**Owned tables:** `plans` (global, app_system only), `subscriptions`, `workspace_entitlement_overrides` (tenant, forced RLS) — migration 0015; `account_subscriptions`, `account_entitlement_overrides`, `message_usage` (app_system only, no tenant grant) — migration 0031; `billing_settings` (one row) and `payments` (app_system only) — migration 0053; schema in `packages/db/src/schema/billing.ts`.

**Public API (`api/`):**

- `BILLING_FACADE` → `entitlements(workspaceId)` → `EntitlementsDto` (e.g. `members.max`). HTTP: `GET /billing/entitlements` (any member).
- `usage(workspaceId)` → `MessageUsageDto` (used / limit / cycle of the account's allowance). HTTP: `GET /billing/usage` (any member).
- `reserveReply(workspaceId, { idempotencyKey, conversationId, botId })` → `ReserveOutcome`, then `captureReply` (delivered) or `releaseReply` (not delivered). Used by the conversation module around every AI reply.
- `startSignupTrial(accountId)` → `boolean`: called by `identity` after signup; idempotent (an account that already has a subscription keeps it); off when the trial setting is off.
- `reserveReply` also refuses with `account_suspended` when the account is suspended (the bot hands the conversation to staff; the dashboard stays usable).
- `BILLING_ADMIN_FACADE` → `BillingAdminFacade` for the platform admin (`backoffice` only): `listPlans`, `createPlan`, `publishPlanVersion`, `archivePlan`, `settings`, `putSettings`, `subscriptionsOf(accountIds)`, `matchAccounts(filter)`, `accountBilling(accountId)`, `setAccountPlan`, `extendTrial`, `putOverride`, `deleteOverride`, `listPayments`, `createPayment`, `confirmPayment`, `cancelPayment`. Every write takes `AdminActor` and the operator's reason.
- `BILLING_RUNNER` → `BillingRunner.tick(now)`: run by the `worker` entry (every 2 s, self-throttled to 5 min): lifecycle transitions, reminders, and the daily usage snapshot.
- Events (outbox, schemas in `packages/contracts/src/billing/billing.events.ts`): `billing.subscription.changed.v1` (every subscription write, with plan name, status, period and `mrrVnd`), `billing.subscription.reminder.v1` (trial ending in 3/1 days, renewal due in 7/1 days, past due), `billing.usage.snapshot.v1` (once per Vietnam day per active account).

**Events consumed:** none.

**Depends on:** `workspace` facade (`accountOf`) to find the account of a business. Never on `account` or `identity` (cycle): its stores read the `accounts` / `workspaces` rows they bill (status, names).

**Invariants:**

- The effective subscription of a business is its account's (`account_subscriptions`); until the backfill copied one, the business's own `subscriptions` row; else `free`. Account overrides apply first, business overrides last.
- The AI-message allowance (`ai.included_messages`) is counted per account per cycle across all its businesses. A plan without the key allows 0 replies. Cycles start at the account subscription's `cycle_anchor` (free: a fixed anchor at 00:00 Vietnam time) and last `periodDays` days.
- One row per reply in `message_usage`, keyed by `(workspace_id, outbound idempotency key)`: retries reuse the row, so a reply is counted once. Reserve takes a per-account advisory lock, so concurrent replies never exceed the allowance. A `reserved` row older than 15 min no longer holds allowance (its process died before deciding).
- A business without an account (before the account backfill) is not metered.

- Entitlements = the plan's limits overlaid with unexpired overrides. `null` means unlimited; a key that is missing means 0 (so a new limit is closed until a plan opens it).
- Plans are seeded (`free`, `sales_smart`, `sales_pro`, `sales_neo`); a workspace with no subscription is on `free` (1 member seat).
- Plan rows and billing settings are cached for 60 s per process (the admin writes invalidate the local cache at once). The operator CLI (`pnpm --filter @agent-sales/backend workspace-plan set|show <owner-email> <plan> [months]`) goes through the same subscription write as the admin (reason `cli`, audited, event written).
- **Plan catalog (ADR-021 §6):** editing a plan publishes `(code, version + 1)`; subscribers keep their version. `expectedVersion` guards concurrent edits (409). `free` has no prices and stays public; a plan named in the trial settings cannot be archived (409).
- **Subscription writes** lock the account's row, check `expectedVersion` (409 on mismatch), bump `version`, and in the same transaction write the platform audit row, `billing.subscription.changed.v1` and a `billing.plan_set` audit row in every business of the account. `mrrVnd` is the monthly price of the period, 0 unless `active`/`past_due` on a priced plan.
- **Signup trial:** when on, a new account starts `trialing` on the trial plan for `trialDays`. **Lazy expiry:** an ended trial is read as the after-trial plan's latest version from the trial end, before the worker writes it.
- **Lifecycle (worker):** trial end → after-trial plan (`active`); paid period end → `past_due`; `past_due` + `graceDays` → `suspended`; `suspended` + `suspendDays` → `free`. Each step is re-decided on the locked row (reason `expiry`). Reminders are sent once per threshold (`reminders_sent`, reset when the period or status moves).
- **Payments (VietQR, manual confirm):** a request has a unique transfer code `RPZ` + 6 characters and the amount = monthly price × months (or the operator's amount); the QR comes from `img.vietqr.io` with the bank account in the settings. Confirming applies the plan: the period starts now, or at the current paid period end when paying ahead.
- A workspace can only read its `subscriptions` and overrides (`app_tenant` has select only, migration 0019); plan changes and overrides are operator writes through `app_system`.
- Shops created before billing carry a `members.max = null` override (`grandfathered…`, migration 0020) instead of falling to the free plan's single seat; remove it when the shop gets a plan.
- Callers never read these tables; they ask the facade. Enforcement belongs to the module that owns the thing being limited (team checks seats), never here.

**Do not:** put HTTP/Drizzle types in `domain/`; read `plans` with the tenant connection; write a subscription outside `changeSubscription` (it is what keeps the audit and event in step).

**Test:** `pnpm --filter @agent-sales/backend test -- billing`, `test/team.integration.spec.ts` (seat limits), `test/billing-usage.integration.spec.ts` (message allowance) `packages/db/src/account-billing.integration.test.ts` (migration 0031 and the subscription backfill) and `test/platform-admin.integration.spec.ts` (migration 0053, trial, plan writes, lifecycle, payments).
