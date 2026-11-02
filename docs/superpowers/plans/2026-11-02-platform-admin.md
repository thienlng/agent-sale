# Platform admin v1 (plan catalog, trial settings, accounts, operator actions, platform events) Implementation Plan

> **For agentic workers:** steps use `- [ ]`. TDD: write the failing test first in every task that adds behaviour.

**Goal:** Operators run Rapiz from `/admin` instead of SSH + CLI: edit the plan catalog, configure the signup trial, browse accounts, change an account's plan, extend a trial, grant overrides and suspend/reactivate, each with a reason and an audit trail. The platform starts publishing the account/billing events Rapiz HQ will consume (PR 3).

**Architecture:** Writes stay in their owning tier-1 modules (`billing` for plans, settings, subscriptions and overrides; `account` for account status). A new tier-3 module **`backoffice`** owns only the admin HTTP surface and read orchestration across the `account`, `workspace`, `identity` and `billing` facades (no tables). Every operator write goes through a module facade that, in one system transaction, changes the row, appends a platform audit row and writes an outbox event.

**Spec / decisions:** `docs/superpowers/specs/2026-11-02-rapiz-hq-saas-design.md` (§3 rules, §9 decisions D1–D7), `docs/adr/ADR-021-rapiz-hq-and-platform-admin.md` (binding).

## Global constraints

- Branch `feat/platform-admin` from `main`; one PR (rule 02). Merge `main` in often: `billing`, `account`, `identity`, `contracts` and i18n are shared with the lodging/commerce lane.
- Migration **0053** (0052 is the last on `main`; re-check before writing). Additive and backward compatible only: the previous release must run on the migrated schema (deploys are automatic now).
- ADR number **021** (written).
- Module graph (ARCHITECTURE §3): `billing` must not import `account` or `identity` (cycle `billing → workspace → account`). Signup trial is started by `identity` calling the `billing` facade. `backoffice` (tier 3) may import tier-1 facades only; nothing imports `backoffice`. `pnpm arch` must stay green.
- Platform admin endpoints use `@PlatformAdmin()` (404 for non-admins), never `@WorkspaceScoped()`.
- **Safe default:** trial settings ship **disabled**; behaviour of existing accounts and signups does not change until an operator turns the trial on.
- Every operator write: mandatory `reason` (3–500 chars), optimistic `version` where a row is replaced, platform audit row, outbox event, all in one transaction.
- Events and logs carry ids, codes and plan facts only; owner email/phone only in `account.account.created.v1` (needed by HQ adoption, ADR-021 §4), never in logs.
- English code/docs; Vietnamese only in `packages/i18n` (vi).
- `pnpm check` green before the PR; fresh-context review with the `review-pr` skill; open with `open-pr`.

---

### Task 0: Docs already on the branch

- [ ] Commit ADR-021, its README row and the English spec (`docs: add ADR-021 and the Rapiz HQ design`). The Vietnamese copy (`*.vi.md`) stays out of the PR (rule 01).

### Task 1: Schema and migration 0053

**Files:** `packages/db/migrations/0053_platform_admin.sql`, `packages/db/src/schema/billing.ts`, `packages/db/src/schema/platform.ts`, migration test in `packages/db` (pattern of existing migration specs).

- [ ] `plans`: add `archived_at timestamptz null` (hidden from new sales, kept for existing subscribers), `sort_order int not null default 0`, `description text not null default ''`, `created_by uuid null references users(id)`. Backfill `sort_order` for the four seeded plans (free 0, smart 10, pro 20, neo 30).
- [ ] New `billing_settings` (global, single row `id = 'default'`): `trial_enabled bool not null default false`, `trial_plan_code text null`, `trial_days int null check (trial_days between 1 and 90)`, `after_trial_plan_code text not null default 'free'`, `hq_contact_scope text not null default 'owner' check in ('owner','owner_and_billing')` (D3, read by PR 3), `version int not null default 1`, `updated_by uuid null`, `updated_at`. Check: enabled ⇒ plan and days set. Seed the default row.
- [ ] New `platform_audit_events` (global): `id uuid pk`, `actor_user_id uuid not null`, `actor_name text`, `action text not null`, `target_type text not null` (`plan|billing_settings|account`), `target_id text`, `reason text not null`, `data jsonb not null default '{}'`, `created_at`. Indexes `(created_at desc)`, `(target_type, target_id, created_at desc)`. Append-only: `app_system` gets select + insert only.
- [ ] Grants: all three `app_system` only; `revoke all … from app_tenant` (same as `plans` in 0015).
- [ ] `outbox_events.workspace_id` is already nullable: account/billing events are written with `workspace_id = null`. Verify the analytics projector ignores types it does not know (it filters by type) — add a test if not covered.
- [ ] Drizzle schema + types; `pnpm --filter @agent-sales/db test`.

### Task 2: Contracts (DTOs, routes, events)

**Files:** `packages/contracts/src/backoffice/{backoffice.schema.ts,backoffice.routes.ts,index.ts}`, `packages/contracts/src/account/account.events.ts`, `packages/contracts/src/billing/billing.events.ts`, `packages/contracts/src/index.ts`, schema tests.

- [ ] Entitlement keys as a closed, typed list `ENTITLEMENT_KEYS` with kind per key (`limit` number|null, `flag` boolean, `models` tier list, `allowance` {amount, periodDays}), matching the seeded JSON. The plan editor validates against it; unknown keys are rejected.
- [ ] Plan DTOs: `PlanDto` (code, version, name, description, isPublic, archived, sortOrder, priceByPeriod `{1?,3?,6?,12?}` integer VND, entitlements, subscriberCount), `CreatePlanRequest` (new code), `PublishPlanVersionRequest` (code + full body + reason), `ArchivePlanRequest` (reason).
- [ ] `BillingSettingsDto` / `PutBillingSettingsRequest` (+ `version`, `reason`).
- [ ] Account DTOs: `AccountListQuery` (q = name/email/phone search, status, planCode, trialing, cursor), `AccountRow` (id, name, owner {name, email}, status, plan {code, version, name}, subStatus, periodEnd, businesses count, createdAt), `AccountDetail` (+ businesses [id, name, industry, createdAt, members count], members [user, role], subscription, overrides, usage {used, limit, cycleEnd}, recent platform audit).
- [ ] Action requests: `SetAccountPlanRequest` (planCode, periodMonths 1|3|6|12, startsOn?, expectedVersion, reason), `ExtendTrialRequest` (until date, expectedVersion, reason), `PutOverrideRequest` (key, value, expiresAt?, reason), `DeleteOverrideRequest` (reason), `SetAccountStatusRequest` (`active|suspended`, reason).
- [ ] Events (Zod, `.v1`): `account.account.created.v1` {accountId, ownerUserId, name, ownerName, ownerEmail, ownerPhone?, occurredAt}; `account.account.status_changed.v1` {accountId, status, occurredAt}; `billing.subscription.changed.v1` {accountId, planCode, planVersion, periodMonths|null, status, periodStart|null, periodEnd|null, reason: `signup_trial|admin|payment|expiry|cancel`, occurredAt}. (`workspace.workspace.status_changed.v1` is deferred: nothing changes workspace status in this PR.)
- [ ] Routes (all under `/admin`): `GET /admin/plans`, `POST /admin/plans`, `POST /admin/plans/{code}/versions`, `POST /admin/plans/{code}/archive`, `GET|PUT /admin/billing-settings`, `GET /admin/accounts`, `GET /admin/accounts/{id}`, `POST /admin/accounts/{id}/plan`, `POST /admin/accounts/{id}/trial`, `PUT|DELETE /admin/accounts/{id}/overrides/{key}`, `POST /admin/accounts/{id}/status`, `GET /admin/audit?targetType&targetId`.

### Task 3: System-transaction outbox and platform audit helpers

**Files:** `packages/db/src/outbox.ts`, `packages/db/src/platform-audit.ts`, `packages/db/src/index.ts`, tests.

- [ ] `writeSystemOutbox(tx: SystemTx, record)` (workspace id null allowed) next to `writeOutbox`.
- [ ] `writePlatformAudit(tx: SystemTx, record)` mirroring `writeAudit`.
- [ ] Unit/integration tests that both run inside `withSystem` and fail under the tenant role.

### Task 4: `account` — created event, status, admin reads

**Files:** `modules/account/{api/account.facade.ts,api/account.events.ts,application/*,domain/account.ts,infrastructure/persistence/*}`, `MODULE.md`, specs.

- [ ] When `resolveForNewBusiness` creates an account, write `account.account.created.v1` in the same system transaction (owner name/email/phone come from the caller: extend the input with `owner: {name, email, phone?}`; `workspace` passes what `identity` gave it — check the `createWorkspace` signature and thread it through, additive).
- [ ] Facade additions: `listForAdmin(query)` (paged, search by account name; owner search is resolved by `backoffice` through identity), `getForAdmin(accountId)`, `setStatus(accountId, status, actor, reason)` (writes status, platform audit, `account.account.status_changed.v1`). Enforcement of `suspended` is PR 2; the admin UI labels it "takes effect when lifecycle enforcement ships".
- [ ] `ACCOUNT_EVENT_TYPES` lists the two new types.
- [ ] Specs: created event written once, not on reuse of an existing account; status change audited; invalid transition rejected.

### Task 5: `billing` — plan catalog, settings, trial, operator actions

**Files:** `modules/billing/{api/billing.facade.ts,api/billing.events.ts,application/billing.service.ts,application/billing-admin.service.ts,application/ports/billing-store.ts,domain/plan-catalog.ts,domain/trial.ts,domain/entitlements.ts,infrastructure/persistence/billing.drizzle-store.ts}`, `MODULE.md`, specs.

- [ ] **Domain `plan-catalog.ts`:** validate a plan body against `ENTITLEMENT_KEYS`; prices are positive integers for periods 1/3/6/12; `free` must keep no prices; the next version = max(version)+1; archiving the plan used by `billing_settings` (trial or after-trial) is rejected.
- [ ] **Domain `trial.ts`:** `trialSubscription(settings, plan, now)` → status `trialing`, `period_start = now`, `period_end = now + trial_days`, `cycle_anchor = now`; and `effectiveSubscription(sub, settings, now)` = **lazy expiry**: a `trialing` row past `period_end` resolves as the after-trial plan (no job needed in this PR; PR 2 adds the job that rewrites the row and emits the event).
- [ ] Wire lazy expiry into `resolveEntitlements` and `usage` (AI allowance) so an expired trial never keeps paid limits. Verify the usage cycle for a trial (`ai.included_messages.periodDays` of the trial plan; anchor = trial start).
- [ ] **Facade additions (used by `identity` and `backoffice`):**
  - `startSignupTrial(accountId)`: no-op when disabled or when the account already has an `account_subscriptions` row; else inserts the trial row + `billing.subscription.changed.v1` (reason `signup_trial`). Idempotent.
  - `listPlans()`, `createPlan`, `publishPlanVersion`, `archivePlan` — each with platform audit.
  - `getSettings()`, `putSettings(body, version, actor, reason)`.
  - `accountSubscription(accountId)`, `accountOverrides(accountId)`, `accountUsage(accountId)`, `subscriberCounts()`.
  - `setAccountPlan`, `extendTrial`, `putAccountOverride`, `deleteAccountOverride` — optimistic `version` on `account_subscriptions`, platform audit, outbox event, and the existing per-workspace `billing.plan_set` audit row for each business of the account (owners keep seeing it in their audit tab; business ids come from the caller, not from a workspace read inside billing beyond the existing `workspace` facade dependency).
- [ ] Plan cache (60 s): invalidate in-process on catalog writes; other processes catch up within 60 s (documented).
- [ ] Keep the `workspace-plan` CLI working; refactor it to call the same service so CLI changes are audited and emit events (actor = `cli`).
- [ ] Specs: catalog validation, version bump, archive guard, trial creation on/off, idempotent trial, lazy expiry in entitlements and usage, optimistic conflict, audit + event written in the same tx (integration).

### Task 6: `identity` — start the trial at signup

**Files:** `modules/identity/application/commands/auth.handlers.ts`, identity module wiring, `MODULE.md`, specs.

- [ ] After `createWorkspace` returns, call `billing.startSignupTrial(accountId)` (needs `createWorkspace` to return the account id — additive). A trial failure is logged and does not fail signup (same "separate transactions on purpose" rule as the workspace step).
- [ ] Facade addition for `backoffice`: `usersByIds(ids)` → `{id, name, email, phone}` and `findUserIdsByQuery(q)` (email/phone/name prefix, max 50) — admin only, never exposed on tenant routes.
- [ ] Update ARCHITECTURE §3 note: `identity` uses the `billing` facade (signup trial).
- [ ] Specs: signup with trial enabled → trialing row; disabled → none; billing failure → signup still succeeds.

### Task 7: New module `backoffice` (tier 3)

**Files:** created with `pnpm gen module backoffice`; `interface/http/{plans,billing-settings,accounts,platform-audit}.controller.ts`, `application/{accounts.query.ts,admin-actions.service.ts}`, `MODULE.md`; register in the api app module; ARCHITECTURE §3 tier-3 row.

- [ ] All controllers `@PlatformAdmin()`; request bodies through `ZodValidationPipe`; actor = `req.auth` (id + display name).
- [ ] `accounts.query`: list = account facade page + identity owners + billing subscription per page (batched, no N+1: one call per facade per page); search `q` matches account name, or owner email/phone/name via identity first. Detail aggregates businesses (workspace facade `listByAccount` — add if missing), members, subscription, overrides, usage, last 20 platform audit rows.
- [ ] Actions delegate to `billing` / `account` facades, passing the account's business ids for the per-workspace audit rows.
- [ ] Error mapping: unknown account/plan → 404, version mismatch → 409 `CONFLICT`, invalid plan body → 400 with issues.
- [ ] Specs (controller-level with in-memory facades): non-admin → 404; each action requires a reason; conflict mapping.

### Task 8: Web — admin screens

**Files:** `apps/web/src/routes/admin/{plans.tsx,accounts/index.tsx,accounts/$accountId.tsx,settings.tsx}`, `apps/web/src/features/admin/{api/*.ts,components/*}`, sidebar entries in `components/layout/app-sidebar.tsx` and `account-sidebar.tsx`, `packages/i18n/src/messages/{vi,en}/common.json`, component tests.

- [ ] **Admin nav:** LLM, Plans, Accounts, Settings (trial). `/admin` index redirects to Accounts.
- [ ] **Plans:** table (name, code, version, prices 1/3/6/12, key limits, subscribers, public/archived). Editor dialog: name, description, prices, entitlements form generated from `ENTITLEMENT_KEYS` (number with "unlimited" toggle, switches, tier multi-select, allowance amount + days), reason. Save = "Publish version N+1" with a note that current subscribers stay on their version. Archive with reason.
- [ ] **Settings (trial):** enable switch, trial plan select (public, not archived), days, after-trial plan, HQ contact scope (only `owner` selectable, the other shown disabled "coming with company contacts"), reason; optimistic version.
- [ ] **Accounts list:** search box, filters (status, plan, on trial, trial ending ≤ 7 days), columns (account, owner email, plan, status, period end, businesses, created). Server pagination.
- [ ] **Account detail:** header (name, status badge, owner), cards: subscription (plan, period, status, dates, usage meter), businesses, members, overrides, audit timeline. Actions in dialogs, each with a required reason: change plan/period, extend trial, add/edit/remove override, suspend/reactivate (with the PR 2 note).
- [ ] All copy via i18n (vi + en); money as VND with the existing formatter; dates in Asia/Ho_Chi_Minh.
- [ ] Tests: route guard (non-admin 404), plan editor validation, action dialogs require a reason, conflict toast on 409.

### Task 9: Tests across the stack

- [ ] Integration (Testcontainers, `apps/backend/test/platform-admin.integration.spec.ts`): migration 0053 applies on a seeded DB; tenant role cannot read the three tables; signup with trial on → trialing + event; set plan → subscription, platform audit, workspace audit, outbox event in one tx; lazy trial expiry changes `GET /billing/entitlements`.
- [ ] Web live-backend e2e (`apps/web` `test:e2e:live`): admin signs in, edits a plan, enables trial, signs up a second user, sees the account trialing, changes its plan.
- [ ] Mocked smoke for the new admin routes.

### Task 10: Docs

- [ ] `docs/08` (billing): plan catalog versions, trial settings, lazy expiry, operator actions, events.
- [ ] `docs/03` (screens): `/admin/accounts`, `/admin/accounts/:id`, `/admin/plans`, `/admin/settings`.
- [ ] `docs/05` (data model): 0053 tables/columns.
- [ ] `docs/02` ADM rows: mark ADM-01/02/03 partially done.
- [ ] `docs/ARCHITECTURE.md` §3: `backoffice` in tier 3; `identity → billing`.
- [ ] `MODULE.md` of `billing`, `account`, `identity`, `backoffice`; `docs/runbooks/deploy-vps.md` step 7–8: after the first admin, configure plans and trial in `/admin`.
- [ ] Spec §7: tick phase 0 items delivered.

### Task 11: Finish

- [ ] Merge `main`, resolve conflicts, `pnpm check` green.
- [ ] Fresh-context review (`review-pr`), fix findings.
- [ ] Open the PR (`open-pr`): `feat(admin): plan catalog, signup trial, accounts and operator actions in the platform admin`. Note in the PR: trial ships disabled; suspension is recorded but enforced in PR 2.
- [ ] After merge (auto-deploy): on production, open `/admin/plans` to check the seeded plans, set the trial (D1: entry plan, days), enable it.

## Out of scope (next PRs)

- **PR 2 — lifecycle:** expiry job (trial → after-trial plan, period end → past_due → suspended → free), enforcement of `suspended` (bot stops, read-only), reminder events.
- **PR 3 — HQ sync:** `hq-init`, consumer in `saas`, adoption, read-only linked fields, backfill, reconcile, usage snapshot event.
- **PR 4 — SaaS vertical v2;** **PR 5 — VietQR payments** confirmed in `/admin`.
- Workspace status event, impersonation, a separate `apps/admin` deployment.

## Risks and checks

| Risk | Mitigation |
|---|---|
| A trial that never ends before PR 2 | Lazy expiry in entitlement and usage resolution (Task 5) |
| Module cycle `billing ↔ account` | Trial started from `identity`; `pnpm arch` in CI |
| Plan edit changes what current customers get | Append-only versions; subscribers keep `(code, version)` |
| Auto-deploy turns trial on for everyone | Settings default disabled; operator enables after review |
| Admin list slow at 1,000+ accounts | Server pagination, batched facade calls, indexes on `accounts.name`, `users.email` (check existing) |
| Conflicts with the other lane in shared files | Merge `main` daily; keep changes additive in contracts and i18n |
