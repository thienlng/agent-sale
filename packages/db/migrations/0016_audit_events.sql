-- 0016_audit_events: append-only trail of workspace and security changes (T-054).
-- Written in the same transaction as the change (writeAudit in packages/db); read by the audit module.

create table if not exists audit_events (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  actor_user_id uuid,
  actor_name text,
  -- "<area>.<thing>.<verb>", e.g. member.role_changed, workspace.profile_updated
  action text not null,
  target_type text not null,
  target_id text,
  -- what changed (field → {from, to}) and context; never secrets or personal data beyond ids
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_workspace_idx on audit_events (workspace_id, created_at desc, id);
create index if not exists audit_events_action_idx on audit_events (workspace_id, action, created_at desc);

alter table audit_events enable row level security;
alter table audit_events force row level security;
drop policy if exists audit_events_tenant on audit_events;
drop policy if exists audit_events_system on audit_events;
create policy audit_events_tenant on audit_events for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy audit_events_system on audit_events for all to app_system using (true) with check (true);

-- Append-only for the application role: it can add and read, never rewrite history.
revoke update, delete on audit_events from app_tenant;
