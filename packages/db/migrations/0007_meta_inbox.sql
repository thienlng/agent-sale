create table channel_connections (
 id uuid primary key, workspace_id uuid not null references workspaces(id), provider text not null check(provider in ('facebook','instagram')), external_id text not null, name text not null, status text not null default 'connected' check(status in ('connected','reauth_required','disconnected')), bot_id uuid, token_sealed text not null, expires_at timestamptz, created_at timestamptz not null default now(), unique(provider,external_id)
);
create index channel_workspace_idx on channel_connections(workspace_id);
create table channel_oauth_flows (
 id uuid primary key, workspace_id uuid not null references workspaces(id), user_id uuid not null, provider text not null, state_hash text not null unique, browser_hash text not null, accounts_sealed text, expires_at timestamptz not null, consumed_at timestamptz
);
create table channel_webhook_events (
 id uuid primary key, workspace_id uuid not null references workspaces(id), connection_id uuid not null references channel_connections(id), external_id text not null, payload jsonb not null, created_at timestamptz not null default now(), processed_at timestamptz, lease_until timestamptz, attempts integer not null default 0, unique(connection_id,external_id)
);
create index channel_webhook_pending_idx on channel_webhook_events(created_at) where processed_at is null;
create table conversations (
 id uuid primary key, workspace_id uuid not null references workspaces(id), channel_id uuid not null references channel_connections(id), customer_id text not null, data jsonb not null, updated_at timestamptz not null default now(), unique(workspace_id,channel_id,customer_id), unique(workspace_id,id)
);
create index conversation_workspace_idx on conversations(workspace_id,updated_at desc);
create table conversation_messages (
 id uuid primary key, workspace_id uuid not null, conversation_id uuid not null, idempotency_key text not null, data jsonb not null, created_at timestamptz not null default now(), foreign key(workspace_id,conversation_id) references conversations(workspace_id,id), unique(workspace_id,conversation_id,idempotency_key)
);
create index conversation_messages_idx on conversation_messages(workspace_id,conversation_id,created_at);
alter table channel_connections enable row level security;
alter table channel_connections force row level security;
create policy channel_connections_tenant on channel_connections for all to app_tenant using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid)) with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy channel_connections_system on channel_connections for all to app_system using (true) with check(true);
alter table channel_oauth_flows enable row level security;
alter table channel_oauth_flows force row level security;
create policy channel_oauth_flows_tenant on channel_oauth_flows for all to app_tenant using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid)) with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy channel_oauth_flows_system on channel_oauth_flows for all to app_system using (true) with check(true);
alter table channel_webhook_events enable row level security;
alter table channel_webhook_events force row level security;
create policy channel_webhook_events_tenant on channel_webhook_events for all to app_tenant using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid)) with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy channel_webhook_events_system on channel_webhook_events for all to app_system using (true) with check(true);
alter table conversations enable row level security;
alter table conversations force row level security;
create policy conversations_tenant on conversations for all to app_tenant using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid)) with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy conversations_system on conversations for all to app_system using (true) with check(true);
alter table conversation_messages enable row level security;
alter table conversation_messages force row level security;
create policy conversation_messages_tenant on conversation_messages for all to app_tenant using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid)) with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy conversation_messages_system on conversation_messages for all to app_system using (true) with check(true);
grant select, insert, update, delete on channel_connections, channel_oauth_flows, channel_webhook_events, conversations, conversation_messages to app_tenant, app_system;
