-- 0007_team_access: invitation links, member removal and roles, and per-source
-- auto-assignment policies for new customers (docs/02 SET-01, SET-02; T-043, T-044, T-033).

-- Roles become owner | admin | sales | care | analyst; older names map to the least
-- privileged fitting role (an owner can promote later). Statuses become active | removed.
update members set role = 'sales' where role in ('sales_manager', 'sale');
update members set role = 'analyst' where role in ('bot_editor', 'accountant');

alter table members add column if not exists removed_at timestamptz;
update members set status = 'removed', removed_at = coalesce(removed_at, now())
  where status not in ('active', 'removed');

-- One row per invitation. Only a SHA-256 hash of the link secret is stored.
create table if not exists invitations (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  email text not null,
  role text not null check (role in ('admin', 'sales', 'care', 'analyst')),
  token_hash text not null,
  invited_by_user_id uuid,
  invited_by_name text,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user_id uuid,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists invitations_token_unique on invitations (token_hash);
create index if not exists invitations_workspace_idx on invitations (workspace_id, created_at desc);
-- At most one usable invitation per email and workspace.
create unique index if not exists invitations_pending_unique on invitations (workspace_id, lower(email))
  where accepted_at is null and revoked_at is null;

-- Weighted round robin per source: `cursor` counts the customers handed out so far.
create table if not exists crm_assignment_policies (
  workspace_id uuid not null references workspaces(id),
  source_id uuid not null references crm_sources(id),
  enabled boolean not null default false,
  candidates jsonb not null default '[]'::jsonb,
  cursor bigint not null default 0,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, source_id)
);

alter table invitations enable row level security;
alter table invitations force row level security;
drop policy if exists invitations_tenant on invitations;
drop policy if exists invitations_system on invitations;
create policy invitations_tenant on invitations for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy invitations_system on invitations for all to app_system using (true) with check (true);

alter table crm_assignment_policies enable row level security;
alter table crm_assignment_policies force row level security;
drop policy if exists crm_assignment_policies_tenant on crm_assignment_policies;
drop policy if exists crm_assignment_policies_system on crm_assignment_policies;
create policy crm_assignment_policies_tenant on crm_assignment_policies for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy crm_assignment_policies_system on crm_assignment_policies for all to app_system using (true) with check (true);
