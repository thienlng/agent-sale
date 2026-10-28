-- T-091 / ADR-012 §5. The account owns the subscription and one message allowance shared by all of
-- its businesses. Additive only: workspace `subscriptions` and their overrides stay as they are
-- (financial history is never rewritten); the `account-backfill` CLI copies the chosen workspace
-- subscription to its account. Until then a business keeps resolving its own workspace subscription.

-- The account's plan. Allowance cycles start at `cycle_anchor` and repeat every
-- `ai.included_messages.periodDays` days of the plan.
create table account_subscriptions (
  account_id uuid primary key references accounts(id),
  plan_code text not null,
  plan_version integer not null,
  period_months integer check (period_months in (1, 3, 6, 12)),
  status text not null default 'active'
    check (status in ('trialing', 'active', 'past_due', 'suspended', 'canceled')),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  cycle_anchor timestamptz not null default now(),
  -- The workspace subscription this one was copied from by the backfill (audit trail).
  source_workspace_id uuid references workspaces(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (plan_code, plan_version) references plans (code, version)
);

-- Add-ons, promotions and deals for the whole account: replace the plan's value for one key.
create table account_entitlement_overrides (
  account_id uuid not null references accounts(id),
  key text not null,
  value jsonb not null,
  reason text not null default '',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (account_id, key)
);

-- One row per AI reply to a customer: reserved before the model runs, captured when the reply is
-- delivered, released when it is not. The outbound idempotency key makes retries and supersedes
-- count once. Usage of a cycle = captured rows + recent reservations of that cycle.
create table message_usage (
  account_id uuid not null references accounts(id),
  workspace_id uuid not null references workspaces(id),
  idempotency_key text not null,
  cycle_start timestamptz not null,
  status text not null check (status in ('reserved', 'captured', 'released')),
  conversation_id uuid,
  bot_id uuid,
  reserved_at timestamptz not null default now(),
  captured_at timestamptz,
  released_at timestamptz,
  primary key (workspace_id, idempotency_key)
);
create index message_usage_cycle_idx on message_usage(account_id, cycle_start)
  where status <> 'released';

-- Account-level billing is platform data reached through the system role only (like accounts).
revoke all on account_subscriptions, account_entitlement_overrides, message_usage from app_tenant;
grant select, insert, update, delete
  on account_subscriptions, account_entitlement_overrides, message_usage to app_system;
