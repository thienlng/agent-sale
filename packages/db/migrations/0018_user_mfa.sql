-- 0018_user_mfa: TOTP second factor (ADM-04). Global table, app_system only (like users).
-- secret_sealed is AES-GCM sealed by the app (SecretBox); recovery codes are stored as sha256 hashes.
create table if not exists user_mfa (
  user_id uuid primary key references users (id) on delete cascade,
  secret_sealed text not null,
  enabled_at timestamptz,
  last_used_step bigint not null default 0,
  recovery_hashes text[] not null default '{}',
  created_at timestamptz not null default now()
);

revoke all on user_mfa from app_tenant;
grant select, insert, update, delete on user_mfa to app_system;
