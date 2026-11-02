-- Public API keys and signed webhooks (ADR-022, VRT-10). Additive only.

-- ─── API keys (identity): `rpz_live_<key_id>_<secret>`, only the SHA-256 of the secret is stored ──
create table if not exists api_keys (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  -- The member the key acts for: it gets `scopes ∩ this member's role`, nothing when they leave.
  created_by uuid not null references users(id),
  name text not null,
  key_id text not null unique check (length(key_id) = 12),
  secret_hash text not null,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists api_keys_workspace_idx on api_keys (workspace_id, created_at desc);
alter table api_keys enable row level security;
alter table api_keys force row level security;
create policy api_keys_tenant on api_keys for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy api_keys_system on api_keys for all to app_system using (true) with check (true);
grant select, insert, update, delete on api_keys to app_tenant, app_system;

-- First response of a write sent with `Idempotency-Key`, replayed for 24 h (per API key).
create table if not exists api_idempotency_keys (
  workspace_id uuid not null references workspaces(id),
  api_key_id uuid not null references api_keys(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 1 and 255),
  -- SHA-256 of method + path + body: the same key with another request is a 422.
  request_hash text not null,
  -- null while the first request is still running (a concurrent retry gets 409).
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (api_key_id, idempotency_key)
);
create index if not exists api_idempotency_keys_created_idx on api_idempotency_keys (created_at);
alter table api_idempotency_keys enable row level security;
alter table api_idempotency_keys force row level security;
create policy api_idempotency_keys_tenant on api_idempotency_keys for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy api_idempotency_keys_system on api_idempotency_keys for all to app_system
  using (true) with check (true);
grant select, insert, update, delete on api_idempotency_keys to app_tenant, app_system;

-- ─── Webhook endpoints (developer) ──────────────────────────────────────────────────────────────
create table if not exists webhook_endpoints (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  url text not null,
  description text not null default '',
  -- Public event types (`PUBLIC_EVENT_TYPES`, without the `.vN` suffix).
  events text[] not null default '{}',
  -- `whsec_…` encrypted with SecretBox; the previous one keeps signing for 24 h after a rotation.
  secret_encrypted text not null,
  previous_secret_encrypted text,
  previous_secret_expires_at timestamptz,
  enabled boolean not null default true,
  -- `failing` (3 days of failures) or `manual`; null while enabled.
  disabled_reason text check (disabled_reason in ('failing', 'manual')),
  -- First failed delivery since the last success.
  failing_since timestamptz,
  created_by uuid not null references users(id),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhook_endpoints_ws_id unique (workspace_id, id)
);
alter table webhook_endpoints enable row level security;
alter table webhook_endpoints force row level security;
create policy webhook_endpoints_tenant on webhook_endpoints for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy webhook_endpoints_system on webhook_endpoints for all to app_system
  using (true) with check (true);
grant select, insert, update, delete on webhook_endpoints to app_tenant, app_system;

-- One event for one endpoint. `event_id` is the envelope id (stable across retries and resends).
create table if not exists webhook_deliveries (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  endpoint_id uuid not null,
  event_id uuid not null,
  event_type text not null,
  -- The full envelope `{ id, type, workspaceId, occurredAt, data }` as sent.
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_status_code integer,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, endpoint_id) references webhook_endpoints (workspace_id, id)
    on delete cascade,
  constraint webhook_deliveries_endpoint_event unique (endpoint_id, event_id)
);
create index if not exists webhook_deliveries_due_idx on webhook_deliveries (next_attempt_at)
  where status = 'pending';
create index if not exists webhook_deliveries_endpoint_idx
  on webhook_deliveries (workspace_id, endpoint_id, created_at desc, id desc);
alter table webhook_deliveries enable row level security;
alter table webhook_deliveries force row level security;
create policy webhook_deliveries_tenant on webhook_deliveries for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy webhook_deliveries_system on webhook_deliveries for all to app_system
  using (true) with check (true);
grant select, insert, update, delete on webhook_deliveries to app_tenant, app_system;

-- Outbox position of the webhook dispatcher (transaction horizon, like `saas_hq_checkpoints`).
create table if not exists webhook_checkpoints (
  consumer text primary key,
  horizon bigint not null default 0,
  updated_at timestamptz not null default now()
);
revoke all on webhook_checkpoints from app_tenant;
grant select, insert, update on webhook_checkpoints to app_system;

-- ─── Plan entitlements: the API is on Pro and Neo (120 requests/min per key), off elsewhere ─────
update plans
set entitlements = entitlements || jsonb_build_object(
  'feature.public_api', code in ('sales_pro', 'sales_neo'),
  'api.requests_per_minute', case when code in ('sales_pro', 'sales_neo') then 120 else 0 end)
where not (entitlements ? 'feature.public_api');
