-- Rapiz HQ sync (ADR-021) and SaaS vertical v2 (spec §6.1–6.5). Additive only.

-- ─── Per-workspace plan catalog (§6.1): MRR is computed from the plan's period price ───────────
create table if not exists saas_plans (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  name text not null,
  -- Price of a whole period in VND, keyed by billing period (monthly, quarterly, semiannual, yearly).
  prices jsonb not null default '{}',
  position integer not null default 0,
  archived_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saas_plans_ws_id unique (workspace_id, id)
);
create unique index if not exists saas_plans_name_active on saas_plans (workspace_id, lower(name))
  where archived_at is null;
alter table saas_plans enable row level security;
alter table saas_plans force row level security;
create policy saas_plans_tenant on saas_plans for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy saas_plans_system on saas_plans for all to app_system using (true) with check (true);
grant select, insert, update, delete on saas_plans to app_tenant, app_system;

-- ─── Subscriptions: free stage, semiannual period, plan link, churn reason, usage, sync link ───
alter table saas_subscriptions drop constraint if exists saas_subscriptions_stage_check;
alter table saas_subscriptions add constraint saas_subscriptions_stage_check
  check (stage in ('trial', 'free', 'active', 'past_due', 'canceled'));
alter table saas_subscriptions drop constraint if exists saas_subscriptions_billing_period_check;
alter table saas_subscriptions add constraint saas_subscriptions_billing_period_check
  check (billing_period in ('monthly', 'quarterly', 'semiannual', 'yearly'));
alter table saas_subscriptions add column if not exists plan_id uuid;
alter table saas_subscriptions add column if not exists churn_reason text
  check (churn_reason is null or churn_reason in
    ('price', 'missing_feature', 'competitor', 'no_longer_needed', 'poor_support', 'business_closed', 'other'));
alter table saas_subscriptions add column if not exists churn_note text not null default '';
-- Set by a sync (`rapiz` = Rapiz HQ, ADR-021): the platform owns plan, stage, dates and MRR.
alter table saas_subscriptions add column if not exists external_source text
  check (external_source is null or external_source in ('rapiz'));
-- Latest AI-reply usage snapshot from the platform (HQ only).
alter table saas_subscriptions add column if not exists usage_used integer;
alter table saas_subscriptions add column if not exists usage_limit integer;
alter table saas_subscriptions add column if not exists usage_at timestamptz;
-- Reminder keys already turned into follow-ups, e.g. {"trial:2026-11-10": "<iso>"}.
alter table saas_subscriptions add column if not exists reminders_sent jsonb not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'saas_subscriptions_plan_fk') then
    alter table saas_subscriptions add constraint saas_subscriptions_plan_fk
      foreign key (workspace_id, plan_id) references saas_plans (workspace_id, id);
  end if;
end $$;
-- Reminder scan across businesses: trials and renewals by date.
create index if not exists saas_subscriptions_trial_end_idx on saas_subscriptions (trial_ends_on)
  where stage = 'trial';
create index if not exists saas_subscriptions_renews_idx on saas_subscriptions (renews_on)
  where stage in ('active', 'past_due');

-- ─── Subscription history (§6.2): one row per plan / stage / MRR change ────────────────────────
create table if not exists saas_subscription_history (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  subscription_id uuid not null references saas_subscriptions(id) on delete cascade,
  contact_id uuid not null,
  from_stage text,
  to_stage text not null,
  from_plan text,
  to_plan text not null,
  from_mrr bigint,
  to_mrr bigint not null,
  churn_reason text,
  -- `staff` | `sync` (Rapiz HQ) | `system`.
  source text not null check (source in ('staff', 'sync', 'system')),
  actor_user_id uuid,
  changed_at timestamptz not null default now()
);
create index if not exists saas_subscription_history_sub_idx
  on saas_subscription_history (workspace_id, subscription_id, changed_at desc);
create index if not exists saas_subscription_history_ws_idx
  on saas_subscription_history (workspace_id, changed_at);
alter table saas_subscription_history enable row level security;
alter table saas_subscription_history force row level security;
create policy saas_subscription_history_tenant on saas_subscription_history for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy saas_subscription_history_system on saas_subscription_history for all to app_system
  using (true) with check (true);
grant select, insert on saas_subscription_history to app_tenant, app_system;

-- ─── Rapiz HQ sync (ADR-021) ───────────────────────────────────────────────────────────────────
-- One row per platform account linked in HQ: which customer, and the last applied event per kind
-- (ordering: an event older than the applied one is ignored).
create table if not exists saas_hq_links (
  workspace_id uuid not null references workspaces(id),
  account_id uuid not null,
  contact_id uuid not null,
  applied jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, account_id)
);
create index if not exists saas_hq_links_contact_idx on saas_hq_links (workspace_id, contact_id);
alter table saas_hq_links enable row level security;
alter table saas_hq_links force row level security;
create policy saas_hq_links_tenant on saas_hq_links for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy saas_hq_links_system on saas_hq_links for all to app_system using (true) with check (true);
grant select, insert, update, delete on saas_hq_links to app_tenant, app_system;

-- Outbox position of the HQ consumer and the last nightly reconcile (platform data, system only).
create table if not exists saas_hq_checkpoints (
  consumer text primary key,
  horizon bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists saas_hq_dead_letters (
  outbox_id bigint primary key,
  type text not null,
  error text not null,
  created_at timestamptz not null default now()
);
revoke all on saas_hq_checkpoints, saas_hq_dead_letters from app_tenant;
grant select, insert, update on saas_hq_checkpoints, saas_hq_dead_letters to app_system;

-- ─── New SaaS customer statuses: "demo scheduled" (§6.4) and "free plan" ──────────────────────
-- Businesses already seeded with the SaaS statuses get them in pipeline order; new businesses get
-- them from the defaults (crm `SAAS_STATUSES`). RLS is forced on crm_statuses and the migration
-- role has no policy of its own, so it is lifted for this one cross-tenant data step.
alter table crm_statuses no force row level security;
do $$
declare r record;
begin
  for r in select workspace_id, position from crm_statuses where key = 'requested' loop
    if not exists (select 1 from crm_statuses where workspace_id = r.workspace_id and key = 'demo_scheduled') then
      update crm_statuses set position = position + 1
        where workspace_id = r.workspace_id and position > r.position;
      insert into crm_statuses (id, workspace_id, key, name, color, position)
        values (gen_random_uuid(), r.workspace_id, 'demo_scheduled', 'Đã hẹn demo', '#8b5cf6', r.position + 1);
    end if;
  end loop;
  for r in select workspace_id, position from crm_statuses where key = 'trial'
      and exists (select 1 from crm_statuses s where s.workspace_id = crm_statuses.workspace_id and s.key = 'paying') loop
    if not exists (select 1 from crm_statuses where workspace_id = r.workspace_id and key = 'free_plan') then
      update crm_statuses set position = position + 1
        where workspace_id = r.workspace_id and position > r.position;
      insert into crm_statuses (id, workspace_id, key, name, color, position)
        values (gen_random_uuid(), r.workspace_id, 'free_plan', 'Dùng gói miễn phí', '#94a3b8', r.position + 1);
    end if;
  end loop;
end $$;
alter table crm_statuses force row level security;

-- Rapiz HQ adoption falls back to email (ADR-021 §3): the oldest live, unlinked customer with it.
create index if not exists contacts_email_unlinked_idx on contacts (workspace_id, email_normalized, created_at)
  where external_id is null and archived_at is null and email_normalized is not null;
