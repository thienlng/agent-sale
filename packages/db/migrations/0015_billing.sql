-- 0015_billing: plan catalog (global), workspace subscriptions and per-workspace entitlement
-- overrides (docs/08 §3, T-053). Money is integer VND per month for each term length.

-- The catalog is platform data, not tenant data: only the system role touches it.
create table if not exists plans (
  code text not null,
  version integer not null default 1,
  name text not null,
  is_public boolean not null default true,
  -- monthly price in VND by term in months: {"3": 1310000, "6": 1050000, "12": 785000}
  price_by_period jsonb not null default '{}'::jsonb,
  -- entitlement key → value. `x.max` numbers: null = unlimited, missing = 0. `feature.*`: boolean.
  entitlements jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (code, version)
);

insert into plans (code, version, name, price_by_period, entitlements) values
  ('free', 1, 'Miễn phí', '{}',
   '{"members.max":1,"channels.max":3,"contacts.max":5000,"storage.bytes":0,"media.max":10,"knowledge_items.max":500,"ai.models.allowed":["smart"],"ai.included_messages":{"amount":1000,"periodDays":14},"feature.website_widget":false,"feature.lazada":false,"feature.facebook_posts":false}'),
  ('sales_smart', 1, 'Sales Smart', '{"3":1310000,"6":1050000,"12":785000}',
   '{"members.max":5,"channels.max":5,"contacts.max":20000,"storage.bytes":10737418240,"media.max":200,"knowledge_items.max":500,"ai.models.allowed":["smart"],"ai.included_messages":{"amount":7000,"periodDays":30},"feature.website_widget":true,"feature.lazada":true,"feature.facebook_posts":true}'),
  ('sales_pro', 1, 'Sales Pro', '{"3":1624000,"6":1299000,"12":974000}',
   '{"members.max":15,"channels.max":20,"contacts.max":50000,"storage.bytes":32212254720,"media.max":200,"knowledge_items.max":500,"ai.models.allowed":["smart","pro"],"ai.included_messages":{"amount":7000,"periodDays":30},"feature.website_widget":true,"feature.lazada":true,"feature.facebook_posts":true}'),
  ('sales_neo', 1, 'Sales Neo', '{"3":2499000,"6":1999000,"12":1624000}',
   '{"members.max":30,"channels.max":100,"contacts.max":null,"storage.bytes":107374182400,"media.max":600,"knowledge_items.max":500,"ai.models.allowed":["smart","pro","neo"],"ai.included_messages":{"amount":7000,"periodDays":30},"feature.website_widget":true,"feature.lazada":true,"feature.facebook_posts":true}')
on conflict (code, version) do nothing;

revoke all on plans from app_tenant;
grant select, insert, update, delete on plans to app_system;

-- A workspace without a row is on the free plan (no backfill needed at signup).
create table if not exists subscriptions (
  workspace_id uuid primary key references workspaces(id),
  plan_code text not null,
  plan_version integer not null,
  period_months integer check (period_months in (1, 3, 6, 12)),
  status text not null default 'active'
    check (status in ('trialing', 'active', 'past_due', 'suspended', 'canceled')),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  foreign key (plan_code, plan_version) references plans (code, version)
);

-- Add-ons, promotions and enterprise deals: a value that replaces the plan's for one key.
create table if not exists workspace_entitlement_overrides (
  workspace_id uuid not null references workspaces(id),
  key text not null,
  value jsonb not null,
  reason text not null default '',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (workspace_id, key)
);

alter table subscriptions enable row level security;
alter table subscriptions force row level security;
drop policy if exists subscriptions_tenant on subscriptions;
drop policy if exists subscriptions_system on subscriptions;
create policy subscriptions_tenant on subscriptions for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy subscriptions_system on subscriptions for all to app_system using (true) with check (true);

alter table workspace_entitlement_overrides enable row level security;
alter table workspace_entitlement_overrides force row level security;
drop policy if exists workspace_entitlement_overrides_tenant on workspace_entitlement_overrides;
drop policy if exists workspace_entitlement_overrides_system on workspace_entitlement_overrides;
create policy workspace_entitlement_overrides_tenant on workspace_entitlement_overrides for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy workspace_entitlement_overrides_system on workspace_entitlement_overrides for all to app_system using (true) with check (true);
