# @agent-sales/db

Drizzle schema, SQL migrations, tenant-scoped transactions and DB roles. **Only `infrastructure/` folders and test helpers may import this package** (enforced by `pnpm arch`).

## Rules (ADR-004, docs/05 §9)

- Every tenant table has `workspace_id`, forced RLS and the InitPlan predicate `workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid)`.
- Tenant access only through `withTenant(db, workspaceId, tx => …)` — transaction-scoped `set_config`, verified after set. Cross-tenant work through `withSystem` (role marker, audited), used only by: webhook ingress channel lookup and event insert, the Meta OAuth callback (state consume), the agent's inbox-queue claim/lease/complete/dead-letter, scheduler/outbox publisher, reconciliation, analytics rollups, the `account` module's global `accounts`/`account_members` tables the `account-backfill` and `bot-profile-backfill` (T-141) CLIs, back-office (ADR-004 amendments 2026-10-24 and 2026-10-28; T-048 narrows the first three).
- Global tables (no `workspace_id`): `users`, `tenant_routes`, `outbox_events` (nullable), `inbox_events` — plus the list in docs/05 §9 as modules are added.
- Schema lives in `src/schema/<module>.ts` (one file per backend module). Migrations are SQL in `migrations/`; `drizzle-kit generate` helps draft them, roles/policies/partitions are hand-written. `drizzle-kit push` is banned.
- Logins: `owner` runs migrations only; `rapiz_tenant` (∈ `app_tenant`) and `rapiz_system` (∈ `app_system`) are what apps use. **Never connect an app as a superuser** — superusers bypass RLS even when it is forced. Every table with `workspace_id` (except global `tenant_routes`, `outbox_events`) must have RLS enabled + forced; an integration test enforces this.
- Connection: PgBouncer transaction mode → `prepare: false`, no session state, no `LISTEN`.

## Commands

```bash
pnpm --filter @agent-sales/db db:generate   # draft a migration from schema changes (review the SQL!)
pnpm --filter @agent-sales/db db:migrate    # apply migrations (DATABASE_URL)
pnpm --filter @agent-sales/db test
```

Local Postgres (pgvector image) comes with `infra/docker/docker-compose.local.yml` (T-004).
