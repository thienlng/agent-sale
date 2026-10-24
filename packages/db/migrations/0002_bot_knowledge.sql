-- 0002_bot_knowledge: bots and FAQ knowledge (docs/05 §3, docs/06). Tenant tables with forced RLS.

create table if not exists bots (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  name text not null,
  industry text not null,
  is_active boolean not null default false,
  settings jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists bots_workspace_idx on bots (workspace_id, created_at);

create table if not exists knowledge_items (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  bot_id uuid not null references bots(id) on delete cascade,
  type text not null default 'faq',
  question text not null,
  answer text not null,
  -- folded (lowercase, no diacritics) question + answer, computed by the app; trigram-indexed
  search_text text not null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists knowledge_items_bot_idx on knowledge_items (workspace_id, bot_id);
create index if not exists knowledge_items_search_trgm on knowledge_items using gin (search_text gin_trgm_ops);

alter table bots enable row level security;
alter table bots force row level security;
drop policy if exists bots_tenant on bots;
drop policy if exists bots_system on bots;
create policy bots_tenant on bots for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy bots_system on bots for all to app_system using (true) with check (true);

alter table knowledge_items enable row level security;
alter table knowledge_items force row level security;
drop policy if exists knowledge_items_tenant on knowledge_items;
drop policy if exists knowledge_items_system on knowledge_items;
create policy knowledge_items_tenant on knowledge_items for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy knowledge_items_system on knowledge_items for all to app_system using (true) with check (true);
