-- 0020_analytics: event-fed statistics projection (T-040, docs/analytics.md).
-- Facts are derived from outbox_events by the analytics projector and can be rebuilt from them.
-- One row per (outbox event, fact kind): replays and retries cannot double count.

create table if not exists analytics_facts (
  id bigserial primary key,
  workspace_id uuid not null references workspaces(id),
  outbox_id bigint not null,
  -- customer.created | phone.captured | tag.assigned | tag.removed | status.changed |
  -- assignment.changed | conversation.opened | message.inbound | message.outbound
  kind text not null,
  -- when it happened (buckets and snapshots use this) vs when the projection saw it
  occurred_at timestamptz not null,
  received_at timestamptz not null,
  -- channel | manual | import | rule
  origin text not null,
  contact_id uuid,
  conversation_id uuid,
  channel_id uuid,
  -- tag.* → tag id and assignment id; status.changed → new status; assignment.changed → new owner
  subject_id uuid,
  from_subject_id uuid,
  ref_id uuid,
  -- assignment.changed: sales | care
  role text,
  unique (workspace_id, outbox_id, kind)
);
create index if not exists analytics_facts_kind_time_idx on analytics_facts (workspace_id, kind, occurred_at);
create index if not exists analytics_facts_contact_idx on analytics_facts (workspace_id, contact_id, kind, occurred_at desc) where contact_id is not null;
create index if not exists analytics_facts_ref_idx on analytics_facts (workspace_id, ref_id) where ref_id is not null;

alter table analytics_facts enable row level security;
alter table analytics_facts force row level security;
drop policy if exists analytics_facts_tenant on analytics_facts;
drop policy if exists analytics_facts_system on analytics_facts;
create policy analytics_facts_tenant on analytics_facts for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy analytics_facts_system on analytics_facts for all to app_system using (true) with check (true);
-- A workspace reads and appends its facts; rewriting or deleting them (rebuild) is an operator action.
revoke update, delete on analytics_facts from app_tenant;

-- Projector position per consumer (global, operator-owned).
create table if not exists analytics_checkpoints (
  consumer text primary key,
  last_outbox_id bigint not null default 0,
  updated_at timestamptz not null default now()
);
revoke all on analytics_checkpoints from app_tenant;
grant select, insert, update, delete on analytics_checkpoints to app_system;

-- Events the projector could not understand (bad payload). Kept for inspection; the projection moves on.
create table if not exists analytics_dead_letters (
  outbox_id bigint primary key,
  workspace_id uuid,
  type text not null,
  error text not null,
  created_at timestamptz not null default now()
);
revoke all on analytics_dead_letters from app_tenant;
grant select, insert, update, delete on analytics_dead_letters to app_system;
