-- 0078_session_assurance: how a session was authenticated, step-up codes and the user security log.
-- Additive and backward compatible: the new columns are nullable or defaulted, so the code running
-- before this migration keeps inserting sessions (they count as neither recent nor two-factor).
--
-- sessions.authenticated_at: when the user last proved a factor on this session (login, signup,
--   Google sign-in or step-up); copied on every refresh rotation. Sensitive actions (API key
--   creation, data export, platform payment/plan changes) need it to be recent.
-- sessions.mfa: the session passed the second factor (login code or a TOTP step-up). Platform
--   admin routes need it.
-- sessions.stepped_up_at: the last explicit step-up (POST /auth/reauth); a sign-in never sets it.
--   A user without a password needs it recent to change two-factor; copied on refresh rotation.
alter table sessions add column if not exists authenticated_at timestamptz;
alter table sessions add column if not exists mfa boolean not null default false;
alter table sessions add column if not exists stepped_up_at timestamptz;

-- A third code purpose: the step-up code emailed to a user without a password.
alter table email_codes drop constraint if exists email_codes_purpose_check;
alter table email_codes
  add constraint email_codes_purpose_check
  check (purpose in ('signup', 'reset_password', 'reauth'));

-- Account-level security events (password reset, two-factor, linked sign-ins, sessions, API keys).
-- Global table, app_system only (like users); append-only for the application.
create table if not exists user_security_events (
  id uuid primary key,
  user_id uuid not null references users (id) on delete cascade,
  action text not null,
  data jsonb not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists user_security_events_user_idx
  on user_security_events (user_id, created_at desc);

revoke all on user_security_events from app_tenant;
grant select, insert on user_security_events to app_system;
