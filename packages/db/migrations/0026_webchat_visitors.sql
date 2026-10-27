-- T-100: website chat visitors. One row per visitor who wrote at least once; the id is the
-- conversation's customer_id. No IP or user agent is stored. Additive: nothing existing changes.
create table webchat_visitors (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  connection_id uuid not null,
  conversation_id uuid,
  first_url text,
  referrer text,
  last_url text,
  last_title text,
  phone_e164 text,
  contact_id uuid,
  phone_captured_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  foreign key (workspace_id, connection_id) references channel_connections(workspace_id, id)
);
create unique index webchat_visitors_connection_id_unique on webchat_visitors(connection_id, id);
create index webchat_visitors_conversation_idx on webchat_visitors(workspace_id, conversation_id);
alter table webchat_visitors enable row level security;
alter table webchat_visitors force row level security;
create policy webchat_visitors_tenant on webchat_visitors for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy webchat_visitors_system on webchat_visitors for all to app_system using (true) with check (true);
