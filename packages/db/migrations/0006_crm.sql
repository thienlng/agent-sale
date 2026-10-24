-- 0006_crm: customers (contacts) with notes and an audit history, customer sources and
-- pipeline statuses, tag definitions with attribute schemas and their assignments, and saved
-- list views (docs/05 §5, docs/02 CRM-01..CRM-09, T-029..T-032). Tenant tables with forced RLS.

-- Sources and statuses: stable ids; archived instead of deleted; `key` marks built-in defaults.
create table if not exists crm_sources (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  key text,
  name text not null,
  color text not null,
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_sources_key_unique on crm_sources (workspace_id, key) where key is not null;
create index if not exists crm_sources_workspace_idx on crm_sources (workspace_id, position);

create table if not exists crm_statuses (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  key text,
  name text not null,
  color text not null,
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_statuses_key_unique on crm_statuses (workspace_id, key) where key is not null;
create index if not exists crm_statuses_workspace_idx on crm_statuses (workspace_id, position);

create table if not exists contacts (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  name text,
  phone text,
  -- E.164, computed by the app (normalizeAnyPhone); null when the phone is not usable
  phone_normalized text,
  email text,
  email_normalized text,
  birthday date,
  gender text check (gender in ('male', 'female', 'other')),
  address text,
  province text,
  ward text,
  phone_provided_at timestamptz,
  address_provided_at timestamptz,
  source_id uuid references crm_sources(id),
  first_source_id uuid references crm_sources(id),
  status_id uuid references crm_statuses(id),
  sales_user_id uuid,
  care_user_id uuid,
  ad_ref text,
  profile_note text not null default '' check (char_length(profile_note) <= 500),
  -- folded name + phone + email (lowercase, no diacritics), computed by the app; trigram-indexed
  search_text text not null default '',
  client_request_id uuid,
  version integer not null default 1,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (name is not null or phone is not null or email is not null)
);
create index if not exists contacts_created_idx on contacts (workspace_id, created_at desc, id);
create index if not exists contacts_phone_idx on contacts (workspace_id, phone_normalized) where phone_normalized is not null;
create index if not exists contacts_email_idx on contacts (workspace_id, email_normalized) where email_normalized is not null;
create index if not exists contacts_search_trgm on contacts using gin (search_text gin_trgm_ops);
create unique index if not exists contacts_client_request_unique on contacts (workspace_id, client_request_id) where client_request_id is not null;

create table if not exists contact_notes (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  contact_id uuid not null references contacts(id),
  body text not null,
  author_user_id uuid,
  author_name text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists contact_notes_contact_idx on contact_notes (contact_id, created_at desc);

-- Append-only audit timeline: one row per change, written in the same transaction as the change.
create table if not exists contact_history (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  contact_id uuid not null references contacts(id),
  type text not null,
  changes jsonb not null default '{}'::jsonb,
  data jsonb not null default '{}'::jsonb,
  actor_user_id uuid,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists contact_history_contact_idx on contact_history (contact_id, created_at desc);

create table if not exists crm_tags (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  name text not null,
  color text not null,
  type text not null check (type in ('classification', 'attribute', 'work')),
  description text not null default '',
  fields jsonb not null default '[]'::jsonb,
  schema_version integer not null default 1,
  is_system boolean not null default false,
  key text,
  created_by_user_id uuid,
  created_by_name text,
  version integer not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_tags_name_unique on crm_tags (workspace_id, lower(name)) where archived_at is null;
create unique index if not exists crm_tags_key_unique on crm_tags (workspace_id, key) where key is not null;

create table if not exists crm_tag_assignments (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  tag_id uuid not null references crm_tags(id),
  -- copied from the tag: classification/attribute tags are unique per entity, work tags repeat
  tag_type text not null,
  scope text not null check (scope in ('contact', 'conversation')),
  entity_id uuid not null,
  values jsonb not null default '{}'::jsonb,
  schema_version integer not null,
  assigned_at timestamptz not null default now(),
  assigned_by_user_id uuid,
  assigned_by_name text,
  removed_at timestamptz,
  removed_by_user_id uuid,
  remove_reason text,
  version integer not null default 1
);
create unique index if not exists crm_tag_assignments_active_unique
  on crm_tag_assignments (workspace_id, tag_id, scope, entity_id)
  where removed_at is null and tag_type <> 'work';
create index if not exists crm_tag_assignments_entity_idx on crm_tag_assignments (scope, entity_id) where removed_at is null;
create index if not exists crm_tag_assignments_tag_idx on crm_tag_assignments (tag_id) where removed_at is null;

create table if not exists saved_views (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  owner_user_id uuid not null,
  owner_name text,
  entity text not null default 'contact',
  name text not null,
  visibility text not null check (visibility in ('private', 'shared')),
  q text not null default '',
  filter jsonb not null,
  sort jsonb not null,
  columns jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists saved_views_workspace_idx on saved_views (workspace_id, entity);

alter table crm_sources enable row level security;
alter table crm_sources force row level security;
drop policy if exists crm_sources_tenant on crm_sources;
drop policy if exists crm_sources_system on crm_sources;
create policy crm_sources_tenant on crm_sources for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy crm_sources_system on crm_sources for all to app_system using (true) with check (true);

alter table crm_statuses enable row level security;
alter table crm_statuses force row level security;
drop policy if exists crm_statuses_tenant on crm_statuses;
drop policy if exists crm_statuses_system on crm_statuses;
create policy crm_statuses_tenant on crm_statuses for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy crm_statuses_system on crm_statuses for all to app_system using (true) with check (true);

alter table contacts enable row level security;
alter table contacts force row level security;
drop policy if exists contacts_tenant on contacts;
drop policy if exists contacts_system on contacts;
create policy contacts_tenant on contacts for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy contacts_system on contacts for all to app_system using (true) with check (true);

alter table contact_notes enable row level security;
alter table contact_notes force row level security;
drop policy if exists contact_notes_tenant on contact_notes;
drop policy if exists contact_notes_system on contact_notes;
create policy contact_notes_tenant on contact_notes for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy contact_notes_system on contact_notes for all to app_system using (true) with check (true);

alter table contact_history enable row level security;
alter table contact_history force row level security;
drop policy if exists contact_history_tenant on contact_history;
drop policy if exists contact_history_system on contact_history;
create policy contact_history_tenant on contact_history for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy contact_history_system on contact_history for all to app_system using (true) with check (true);

alter table crm_tags enable row level security;
alter table crm_tags force row level security;
drop policy if exists crm_tags_tenant on crm_tags;
drop policy if exists crm_tags_system on crm_tags;
create policy crm_tags_tenant on crm_tags for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy crm_tags_system on crm_tags for all to app_system using (true) with check (true);

alter table crm_tag_assignments enable row level security;
alter table crm_tag_assignments force row level security;
drop policy if exists crm_tag_assignments_tenant on crm_tag_assignments;
drop policy if exists crm_tag_assignments_system on crm_tag_assignments;
create policy crm_tag_assignments_tenant on crm_tag_assignments for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy crm_tag_assignments_system on crm_tag_assignments for all to app_system using (true) with check (true);

alter table saved_views enable row level security;
alter table saved_views force row level security;
drop policy if exists saved_views_tenant on saved_views;
drop policy if exists saved_views_system on saved_views;
create policy saved_views_tenant on saved_views for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy saved_views_system on saved_views for all to app_system using (true) with check (true);

