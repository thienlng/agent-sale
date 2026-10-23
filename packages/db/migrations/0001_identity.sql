-- 0001_identity: sessions (refresh-token rotation), identity tables restricted to app_system,
-- default privileges for future tables (ADR-004, ADR-007, docs/09 §2).

create table if not exists sessions (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  family_id uuid not null,
  token_hash text not null unique,
  user_agent text,
  ip text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  rotated_at timestamptz,
  revoked_at timestamptz
);
create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists sessions_family_idx on sessions (family_id);

-- Emails are compared case-insensitively; stored lowercase by the app.
create unique index if not exists users_email_lower_idx on users (lower(email));

-- Identity data is cross-tenant: only the system role (identity module, back-office) may touch it.
-- Tenant connections keep REFERENCES-free access through FKs, which are checked as the table owner.
revoke all on users from app_tenant;
revoke all on sessions from app_tenant;
grant select, insert, update, delete on users, sessions to app_system;

-- Future tables get the standard grants; RLS policies are still added per table.
alter default privileges in schema public grant select, insert, update, delete on tables to app_tenant, app_system;
alter default privileges in schema public grant usage, select on sequences to app_tenant, app_system;
