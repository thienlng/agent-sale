-- T-069: isolated post-comment state; existing Messenger behavior is unchanged.
create unique index channel_connections_workspace_id_unique on channel_connections(workspace_id,id);
create table fanpage_settings (
  workspace_id uuid not null references workspaces(id),
  connection_id uuid primary key,
  settings jsonb not null default '{}'::jsonb,
  foreign key(workspace_id,connection_id) references channel_connections(workspace_id,id)
);
create table fanpage_comments (
  workspace_id uuid not null references workspaces(id),
  connection_id uuid not null,
  comment_id text not null,
  document jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (connection_id, comment_id),
  foreign key(workspace_id,connection_id) references channel_connections(workspace_id,id)
);
create index fanpage_comments_workspace_idx on fanpage_comments(workspace_id, connection_id, updated_at desc);
create index fanpage_private_reply_idx on fanpage_comments using gin ((document->'actions') jsonb_path_ops);
alter table fanpage_settings enable row level security;
alter table fanpage_settings force row level security;
alter table fanpage_comments enable row level security;
alter table fanpage_comments force row level security;
create policy fanpage_settings_tenant on fanpage_settings to app_tenant using (workspace_id = nullif(current_setting('app.workspace_id',true),'')::uuid) with check (workspace_id = nullif(current_setting('app.workspace_id',true),'')::uuid);
create policy fanpage_comments_tenant on fanpage_comments to app_tenant using (workspace_id = nullif(current_setting('app.workspace_id',true),'')::uuid) with check (workspace_id = nullif(current_setting('app.workspace_id',true),'')::uuid);
grant select, insert, update, delete on fanpage_settings, fanpage_comments to app_tenant;
