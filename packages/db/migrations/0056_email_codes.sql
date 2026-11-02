-- 0056_email_codes: emailed one-time codes (signup, password reset; ACC-01, ADR-023).
-- Global table, app_system only (like users). One live code per address and purpose: a signup
-- code exists before its user, so the key is the lower-cased email, not a user id. The code
-- itself is stored as a sha256 hash.
create table if not exists email_codes (
  email text not null,
  purpose text not null check (purpose in ('signup', 'reset_password')),
  code_hash text not null,
  attempts integer not null default 0,
  sent_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (email, purpose)
);

revoke all on email_codes from app_tenant;
grant select, insert, update, delete on email_codes to app_system;

-- Signup now proves the email with a code: every user created before it counts as verified.
update users set email_verified_at = created_at where email_verified_at is null;
