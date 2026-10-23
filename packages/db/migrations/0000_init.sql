-- 0000_init: extensions, roles, global tables, first tenant tables, RLS (ADR-004, docs/05 §9).
-- Hand-written on purpose: roles/policies/partitions are outside drizzle-kit's scope. Idempotent.

create extension if not exists "vector";
create extension if not exists "pg_trgm";
create extension if not exists "unaccent";
create extension if not exists "citext";

-- Roles: neither owns tables nor has BYPASSRLS. Passwords are set by the deploy tooling.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_tenant') then create role app_tenant nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'app_system') then create role app_system nologin; end if;
end $$;

-- Global tables
create table if not exists users (
  id uuid primary key,
  email text not null unique,
  email_verified_at timestamptz,
  phone text,
  phone_verified_at timestamptz,
  password_hash text,
  name text not null,
  timezone text not null default 'Asia/Ho_Chi_Minh',
  locale text not null default 'vi',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tenant_routes (
  workspace_id uuid primary key,
  database_key text not null default 'primary',
  updated_at timestamptz not null default now()
);

create table if not exists outbox_events (
  id bigserial primary key,
  workspace_id uuid,
  type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists outbox_events_unpublished_idx on outbox_events (id) where published_at is null;

create table if not exists inbox_events (
  consumer text not null,
  event_id text not null,
  processed_at timestamptz not null default now(),
  primary key (consumer, event_id)
);

-- Tenant tables
create table if not exists workspaces (
  id uuid primary key,
  workspace_id uuid not null,
  name text not null,
  industry text not null,
  timezone text not null default 'Asia/Ho_Chi_Minh',
  owner_user_id uuid not null references users(id),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint workspaces_self_ref check (workspace_id = id)
);
create index if not exists workspaces_owner_idx on workspaces (owner_user_id);

create table if not exists members (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  user_id uuid not null references users(id),
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index if not exists members_workspace_user_idx on members (workspace_id, user_id);

-- RLS: forced, InitPlan predicate, system marker for app_system work.
alter table workspaces enable row level security;
alter table workspaces force row level security;
drop policy if exists workspaces_tenant on workspaces;
create policy workspaces_tenant on workspaces for all to app_tenant, app_system
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid)
         or current_setting('app.role', true) = 'system')
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid)
         or current_setting('app.role', true) = 'system');

alter table members enable row level security;
alter table members force row level security;
drop policy if exists members_tenant on members;
create policy members_tenant on members for all to app_tenant, app_system
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid)
         or current_setting('app.role', true) = 'system')
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid)
         or current_setting('app.role', true) = 'system');

grant select, insert, update, delete on all tables in schema public to app_tenant, app_system;
grant usage, select on all sequences in schema public to app_tenant, app_system;
