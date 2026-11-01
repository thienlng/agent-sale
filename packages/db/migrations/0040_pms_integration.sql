-- PMS integration (ADR-017): connections, lease jobs, raw webhook deliveries, picture cache, sync log,
-- and external link columns on the catalog and orders.
create table integration_connections (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null check (provider in ('kiotviet')),
  status text not null check (status in ('connected','syncing','error','disconnected')),
  retailer text not null,
  client_id text not null,
  client_secret_sealed text not null,
  webhook_token text not null unique,
  webhook_secret_sealed text not null,
  settings jsonb not null,
  version integer not null default 1,
  progress jsonb,
  counts jsonb not null default '{}'::jsonb,
  last_error jsonb,
  last_full_sync_at timestamptz,
  last_reconcile_at timestamptz,
  connected_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disconnected_at timestamptz
);
create unique index integration_connections_live on integration_connections (workspace_id, provider)
  where status <> 'disconnected';

create table integration_jobs (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connection_id uuid not null references integration_connections(id) on delete cascade,
  -- push_order / customer_import are used from PR 2 / PR 3; allowed now so they need no migration.
  kind text not null check (kind in ('full_import','reconcile','webhook','push_order','customer_import')),
  payload jsonb not null default '{}'::jsonb,
  cursor jsonb,
  run_after timestamptz not null default now(),
  lease_until timestamptz,
  claim_token uuid,
  attempts integer not null default 0,
  last_error text,
  done_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now()
);
create index integration_jobs_ready on integration_jobs (run_after) where done_at is null and failed_at is null;
create unique index integration_jobs_one_sync on integration_jobs (connection_id)
  where kind in ('full_import','reconcile') and done_at is null and failed_at is null;

create table integration_webhook_events (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connection_id uuid not null references integration_connections(id) on delete cascade,
  delivery_id text not null,
  body text not null,
  signature text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (connection_id, delivery_id)
);
create index integration_webhook_events_open on integration_webhook_events (received_at) where processed_at is null;

create table integration_image_cache (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_url text not null,
  stored_url text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, source_url)
);

create table integration_sync_log (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connection_id uuid not null references integration_connections(id) on delete cascade,
  level text not null check (level in ('info','warning','error')),
  code text not null,
  params jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index integration_sync_log_recent on integration_sync_log (connection_id, at desc);

alter table products add column external_source text, add column external_id text,
  -- A link is the provider and its id together, or neither (a half link would lock a product nobody syncs).
  add constraint products_external_pair_check check ((external_id is null) = (external_source is null));
create unique index products_external on products (workspace_id, external_source, external_id)
  where external_id is not null;
alter table product_variants add column external_id text;
create unique index product_variants_external on product_variants (workspace_id, external_id)
  where external_id is not null;
alter table orders
  add column external_source text, add column external_id text, add column external_code text,
  add column external_status text,
  add column external_state text check (external_state in ('pending','pushed','failed')),
  add column external_error jsonb, add column external_pushed_at timestamptz;

-- Row-level tenant isolation (ADR-004), same shape as 0039.

alter table integration_connections enable row level security;
alter table integration_connections force row level security;
create policy integration_connections_tenant on integration_connections for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy integration_connections_system on integration_connections for all to app_system using (true) with check (true);

alter table integration_jobs enable row level security;
alter table integration_jobs force row level security;
create policy integration_jobs_tenant on integration_jobs for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy integration_jobs_system on integration_jobs for all to app_system using (true) with check (true);

alter table integration_webhook_events enable row level security;
alter table integration_webhook_events force row level security;
create policy integration_webhook_events_tenant on integration_webhook_events for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy integration_webhook_events_system on integration_webhook_events for all to app_system using (true) with check (true);

alter table integration_image_cache enable row level security;
alter table integration_image_cache force row level security;
create policy integration_image_cache_tenant on integration_image_cache for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy integration_image_cache_system on integration_image_cache for all to app_system using (true) with check (true);

alter table integration_sync_log enable row level security;
alter table integration_sync_log force row level security;
create policy integration_sync_log_tenant on integration_sync_log for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy integration_sync_log_system on integration_sync_log for all to app_system using (true) with check (true);

-- Default privileges (0001) already cover new tables; stated explicitly as in 0007.
grant select, insert, update, delete on
  integration_connections, integration_jobs, integration_webhook_events,
  integration_image_cache, integration_sync_log
  to app_tenant, app_system;
