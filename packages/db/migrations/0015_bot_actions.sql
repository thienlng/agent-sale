-- T-055: API actions the bot may call, their run log and the pending confirmation. Additive.
create table bot_actions (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 bot_id uuid not null references bots(id) on delete cascade,
 name text not null, description text not null, url text not null,
 method text not null check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
 params jsonb not null default '[]'::jsonb, responses jsonb not null default '[]'::jsonb,
 auth_kind text not null default 'none' check (auth_kind in ('none', 'api_key', 'bearer')),
 auth_header_name text, auth_secret_enc text,
 requires_confirm boolean not null default false, enabled boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index bot_actions_bot_idx on bot_actions (workspace_id, bot_id);
-- No arguments and no response bodies are stored here (PII).
create table action_runs (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 action_id uuid not null references bot_actions(id) on delete cascade,
 conversation_id uuid, status_code integer, ok boolean not null, latency_ms integer not null,
 error_code text, is_test boolean not null default false, created_at timestamptz not null default now()
);
create index action_runs_action_idx on action_runs (workspace_id, action_id, created_at);
-- One write call awaiting the customer's confirmation per conversation (10-minute TTL).
create table action_pending (
 conversation_id uuid primary key, workspace_id uuid not null references workspaces(id),
 action_id uuid not null references bot_actions(id) on delete cascade,
 args jsonb not null, expires_at timestamptz not null
);
create index action_pending_expiry_idx on action_pending (expires_at);
alter table bot_actions enable row level security;
alter table bot_actions force row level security;
create policy bot_actions_tenant on bot_actions for all to app_tenant
 using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
 with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy bot_actions_system on bot_actions for all to app_system using (true) with check (true);
alter table action_runs enable row level security;
alter table action_runs force row level security;
create policy action_runs_tenant on action_runs for all to app_tenant
 using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
 with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy action_runs_system on action_runs for all to app_system using (true) with check (true);
alter table action_pending enable row level security;
alter table action_pending force row level security;
create policy action_pending_tenant on action_pending for all to app_tenant
 using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
 with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy action_pending_system on action_pending for all to app_system using (true) with check (true);
