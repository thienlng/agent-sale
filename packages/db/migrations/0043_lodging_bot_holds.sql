-- 0043_lodging_bot_holds (T-161): holds the bot places for customers in chat. Additive only:
-- the review state of bot holds and the draft the customer confirms (one per conversation).

-- A bot hold waits for staff ("chờ xử lý") while source = 'bot', status = 'hold' and reviewed_at
-- is null; any staff status action or edit of a bot booking sets reviewed_at / reviewed_by.
alter table lodging_bookings add column if not exists reviewed_at timestamptz;
alter table lodging_bookings add column if not exists reviewed_by uuid;
create index if not exists lodging_bookings_review_idx on lodging_bookings (workspace_id)
  where source = 'bot' and status = 'hold' and reviewed_at is null;

-- The hold the bot summarised and the customer has not confirmed yet (one per conversation,
-- 30 minutes). Prices are quoted again on confirm and compared through quote_hash.
create table if not exists lodging_bot_hold_drafts (
  workspace_id uuid not null references workspaces(id),
  conversation_id uuid not null,
  -- New on every prepare; the confirmed booking's client_request_id is derived from it.
  id uuid not null,
  bot_id uuid not null,
  -- Shown as the actor of the booking's history.
  bot_name text not null default '',
  channel text not null,
  contact_id uuid,
  property_id uuid not null,
  whole boolean not null,
  unit_ids uuid[] not null default '{}',
  check_in date not null,
  check_out date not null,
  adults int not null check (adults between 0 and 1000),
  child_ages int[] not null default '{}',
  guest_name text not null check (char_length(guest_name) between 1 and 200),
  -- National form 0xxxxxxxxx.
  guest_phone text not null check (char_length(guest_phone) <= 30),
  note text not null default '' check (char_length(note) <= 2000),
  quote_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (workspace_id, conversation_id),
  constraint lodging_bot_hold_drafts_property_fk foreign key (workspace_id, property_id)
    references lodging_properties (workspace_id, id) on delete cascade
);
create index if not exists lodging_bot_hold_drafts_expiry_idx
  on lodging_bot_hold_drafts (workspace_id, expires_at);

-- Forced RLS, same policies as 0041 / tenantPolicies() in the Drizzle schema.
alter table lodging_bot_hold_drafts enable row level security;
alter table lodging_bot_hold_drafts force row level security;
drop policy if exists lodging_bot_hold_drafts_tenant on lodging_bot_hold_drafts;
drop policy if exists lodging_bot_hold_drafts_system on lodging_bot_hold_drafts;
create policy lodging_bot_hold_drafts_tenant on lodging_bot_hold_drafts for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy lodging_bot_hold_drafts_system on lodging_bot_hold_drafts for all to app_system
  using (true) with check (true);
grant select, insert, update, delete on lodging_bot_hold_drafts to app_tenant, app_system;
