-- 0072_user_identities: sign-in through an external identity provider (Google, ADR-007).
-- Global table, app_system only (like users). One row per provider account; the provider's stable
-- subject id is the key, so a user who changes the Google address still signs in. Additive.
create table if not exists user_identities (
  provider text not null check (provider in ('google')),
  subject text not null,
  user_id uuid not null references users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  primary key (provider, subject)
);

create index if not exists user_identities_user_idx on user_identities (user_id);

revoke all on user_identities from app_tenant;
grant select, insert, update, delete on user_identities to app_system;
