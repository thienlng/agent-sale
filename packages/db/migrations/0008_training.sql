-- Additive bot training materials and immutable change history. No binary media is fetched.
create table training_items (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 bot_id uuid not null references bots(id) on delete cascade,
 kind text not null check (kind in ('scenario', 'quick_reply', 'media')),
 title text not null, content text not null, trigger text not null default '', media_url text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index training_items_bot_idx on training_items (workspace_id, bot_id);
create table training_history (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 bot_id uuid not null references bots(id) on delete cascade, item_id uuid not null,
 title text not null, kind text not null check (kind in ('scenario', 'quick_reply', 'media', 'faq', 'settings')),
 action text not null check (action in ('created', 'updated', 'deleted')), created_at timestamptz not null default now()
);
create index training_history_bot_idx on training_history (workspace_id, bot_id, created_at);
alter table training_items enable row level security;
alter table training_items force row level security;
create policy training_items_tenant on training_items for all to app_tenant
 using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
 with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy training_items_system on training_items for all to app_system using (true) with check (true);
alter table training_history enable row level security;
alter table training_history force row level security;
create policy training_history_tenant on training_history for all to app_tenant
 using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
 with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy training_history_system on training_history for all to app_system using (true) with check (true);

-- Existing catalog records remain valid and gain optional bot guidance.
alter table products add column bot_instructions text not null default '';
