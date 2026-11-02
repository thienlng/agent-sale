# backoffice

**Purpose:** the platform admin's HTTP surface (`/admin/*`, ADR-021 §6): plan catalog, billing settings, customer accounts, manual VietQR payments and the operator audit trail. Tier 3: it orchestrates tier-1 facades and owns no business rules.

**Owned tables:** none. Reads `platform_audit_events` (global, app_system only, migration 0053), which the owning modules append to inside the transaction of each operator action.

**Public API (`api/`):**
- `BACKOFFICE_FACADE` → `listAccounts(query)`, `accountDetail(accountId)`, `listAudit(query)` (read views; nothing else imports this module)
- HTTP (contracts in `packages/contracts/src/backoffice/`, every route `@PlatformAdmin()`, non-admins get 404):
  - `GET|POST /admin/plans`, `POST /admin/plans/:code/versions`, `POST /admin/plans/:code/archive`
  - `GET|PUT /admin/billing-settings`
  - `GET /admin/accounts`, `GET /admin/accounts/:accountId`, `POST …/plan`, `POST …/trial`, `PUT|DELETE …/overrides/:key`, `POST …/status`, `POST …/payments`
  - `GET /admin/payments`, `POST /admin/payments/:paymentId/confirm|cancel`
  - `GET /admin/audit`
- Events: none.

**Depends on:** `account` (`listForAdmin`, `getForAdmin`, `membersForAdmin`, `setStatus`), `workspace` (`listByAccounts`), `identity` (`IDENTITY_ADMIN_FACADE`), `billing` (`BILLING_ADMIN_FACADE`).

**Invariants:**
- Writes go to the owning module's facade with the signed-in admin as actor and the operator's reason; this module never writes a table.
- Lists are batched: one call per module per page, never one per row. Billing filters (`subscriptionStatus`, `planCode`, `endingWithinDays`) resolve to an account id list (or an exclusion list for `free`) before the account query; `q` matches the account name or the owner's email/phone/name.
- Domain errors map through the global filter: unknown ids 404, version or state conflicts 409, rule violations 400.

**Do not:** add tables; call other modules' internals; expose these read views on tenant routes.

**Test:** `pnpm --filter @agent-sales/backend test -- backoffice`, `test/platform-admin.integration.spec.ts`, and the `@PlatformAdmin()` 404 cases in `test/http.spec.ts`.
