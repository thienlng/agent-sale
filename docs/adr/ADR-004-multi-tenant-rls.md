# ADR-004: Multi-tenant shared schema + Row-Level Security

- Status: Proposed · Date: 2026-10-23 · Revised 2026-10-23 after independent review (PgBouncer leak, system role)

## Decision

- Every tenant table has `workspace_id`; RLS is **forced** (`ALTER TABLE … FORCE ROW LEVEL SECURITY`) on every tenant table; the application roles do not own tables and have no `BYPASSRLS`.
- Tenant context is **transaction-scoped only**: `select set_config('app.workspace_id', $1, true)` inside an explicit transaction. Plain `SET` is forbidden because the connection pooler runs in transaction mode and a session GUC would leak to the next tenant's request.
- All tenant data access goes through one helper exported by `packages/db`: `withTenant(workspaceId, fn)` — opens the transaction, sets the GUC, runs `fn(tx)`. An ESLint rule forbids importing the raw `db` handle outside `packages/db`. The repository layer **also** filters by `workspace_id` explicitly; RLS is the backstop, not the only gate.
- Policies read the context as `workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid)` — the `(select …)` makes it an InitPlan (evaluated once), `nullif` avoids the empty-string cast error, and a missing context yields **no rows and an application-level assertion** (`withTenant` throws if the GUC is unset after the transaction starts), never silent cross-tenant reads.
- Two database roles with **role-scoped policies**: `app_tenant` (policy `TO app_tenant` with the tenant predicate; API, agent, tenant-scoped jobs) and `app_system` (policy `TO app_system USING (true)`; still no `BYPASSRLS`; every use audited). Processes connect with different login users (`rapiz_tenant` ∈ `app_tenant`, `rapiz_system` ∈ `app_system`). A GUC-based "system mode" is forbidden: any connection could set it. `app_system` is used only by webhook ingress (channel lookup by external id before the tenant is known — via a single `SECURITY DEFINER` function), the scheduler/outbox publisher, nightly reconciliation, analytics rollups and the back-office. The allowed processes are listed in `packages/db/README.md`.
- Global (non-tenant) tables are explicitly classified in `docs/05` §9 (users, sessions, plans, vouchers, vertical_packs, admin_units, feature_flags, affiliate_*); everything else is a tenant table.
- Connection pooling: PgBouncer ≥ 1.21 in transaction mode with `max_prepared_statements` enabled (or the driver configured with `prepare: false`); no `LISTEN`, no session state, no temp tables.
- CI runs an integration test that executes two tenants' queries sequentially through one pooled connection and asserts isolation, plus a test that a query outside `withTenant` fails.

## Consequences

Defense in depth without a performance cliff (InitPlan policies, `(workspace_id, …)`-leading indexes). Jobs and workers must run inside `withTenant`. A tenant can later be moved to a dedicated database by changing its `tenant_routes` entry (see `docs/17` §6); the code path is the same helper.
