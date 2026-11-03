-- ADR-021: platform admin v1. Operators edit the plan catalog, the signup trial and accounts in
-- /admin; every action is audited globally; manual VietQR bank-transfer payments are confirmed by an
-- operator. Additive only: the previous release runs unchanged on this schema.

-- Plan catalog editor: an edit inserts a new (code, version); archived plans are hidden from new
-- sales and kept for current subscribers.
alter table plans add column if not exists description text not null default '';
alter table plans add column if not exists sort_order integer not null default 0;
alter table plans add column if not exists archived_at timestamptz;
alter table plans add column if not exists created_by uuid references users(id);
update plans set sort_order = case code
  when 'free' then 0 when 'sales_smart' then 10 when 'sales_pro' then 20 when 'sales_neo' then 30
  else sort_order end;

-- Global billing settings (single row). The trial ships disabled: auto-deploy changes nothing until
-- an operator turns it on.
create table if not exists billing_settings (
  id text primary key default 'default' check (id = 'default'),
  trial_enabled boolean not null default false,
  trial_plan_code text,
  trial_days integer check (trial_days between 1 and 90),
  after_trial_plan_code text not null default 'free',
  -- Who is synced to Rapiz HQ (ADR-021 §4): only `owner` is supported now.
  hq_contact_scope text not null default 'owner' check (hq_contact_scope in ('owner', 'owner_and_billing')),
  -- Lifecycle (PR 2): days in past_due before suspension, days suspended before the free plan.
  grace_days integer not null default 7 check (grace_days between 0 and 60),
  suspend_days integer not null default 30 check (suspend_days between 0 and 365),
  -- VietQR bank transfer (manual confirm). Bank BIN per napas, account number and holder name.
  bank_bin text,
  bank_account_no text,
  bank_account_name text,
  version integer not null default 1,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  check (not trial_enabled or (trial_plan_code is not null and trial_days is not null))
);
insert into billing_settings (id) values ('default') on conflict (id) do nothing;

-- Append-only trail of operator actions (global, no tenant). Per-business trails stay in audit_events.
create table if not exists platform_audit_events (
  id uuid primary key,
  actor_user_id uuid,
  actor_name text,
  action text not null,
  target_type text not null,
  target_id text,
  reason text not null default '',
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists platform_audit_created_idx on platform_audit_events (created_at desc);
create index if not exists platform_audit_target_idx
  on platform_audit_events (target_type, target_id, created_at desc);

-- Manual payments (VietQR transfer confirmed by an operator). One row per payment request; the
-- transfer content carries `code` so the operator can match the bank statement.
create table if not exists payments (
  id uuid primary key,
  account_id uuid not null references accounts(id),
  code text not null unique,
  plan_code text not null,
  plan_version integer not null,
  period_months integer not null check (period_months in (1, 3, 6, 12)),
  amount_vnd bigint not null check (amount_vnd > 0),
  method text not null default 'vietqr' check (method in ('vietqr')),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'canceled')),
  requested_by uuid references users(id),
  confirmed_by uuid references users(id),
  confirmed_at timestamptz,
  bank_reference text,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (plan_code, plan_version) references plans (code, version)
);
create index if not exists payments_account_idx on payments (account_id, created_at desc);
create index if not exists payments_pending_idx on payments (created_at) where status = 'pending';

-- Lifecycle bookkeeping (PR 2): when the subscription entered its current status, and which
-- reminders were already sent for the current period (idempotent jobs).
alter table account_subscriptions add column if not exists status_changed_at timestamptz not null default now();
alter table account_subscriptions add column if not exists reminders_sent jsonb not null default '{}';

-- Account suspension bookkeeping.
alter table accounts add column if not exists status_reason text not null default '';
alter table accounts add column if not exists status_changed_at timestamptz;

revoke all on billing_settings, platform_audit_events, payments from app_tenant;
grant select, insert, update on billing_settings to app_system;
grant select, insert on platform_audit_events to app_system;
grant select, insert, update on payments to app_system;
