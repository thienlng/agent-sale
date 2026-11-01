-- 0042_lodging_notes_tags (T-160 calendar polish): staff-only night notes, a staff-only note per
-- property and free-text booking tags. Additive only: new table, new columns with defaults.

alter table lodging_properties
  add column if not exists internal_note text not null default '';
alter table lodging_properties
  drop constraint if exists lodging_properties_internal_note_len;
alter table lodging_properties
  add constraint lodging_properties_internal_note_len check (char_length(internal_note) <= 2000);

alter table lodging_bookings
  add column if not exists tags text[] not null default '{}';
alter table lodging_bookings
  drop constraint if exists lodging_bookings_tags_limits;
-- At most 8 tags; the per-tag length (≤ 30) is checked by the API (CHECK cannot hold a subquery).
alter table lodging_bookings
  add constraint lodging_bookings_tags_limits check (cardinality(tags) <= 8);
create index if not exists lodging_bookings_tags_idx on lodging_bookings using gin (tags);

-- One internal note per night of a property (unit_id null) or of one room. NULLS NOT DISTINCT makes
-- the property-level note (null unit) unique too, so the upsert can target the constraint.
create table if not exists lodging_night_notes (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  property_id uuid not null,
  unit_id uuid,
  night date not null,
  text text not null check (char_length(text) between 1 and 300),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint lodging_night_notes_property_fk foreign key (workspace_id, property_id)
    references lodging_properties (workspace_id, id) on delete cascade,
  -- MATCH SIMPLE: a null unit_id (property-level note) is not checked.
  constraint lodging_night_notes_unit_fk foreign key (workspace_id, unit_id)
    references lodging_units (workspace_id, id) on delete cascade,
  constraint lodging_night_notes_unique unique nulls not distinct (workspace_id, property_id, unit_id, night)
);
create index if not exists lodging_night_notes_range_idx
  on lodging_night_notes (workspace_id, property_id, night);

-- Forced RLS, same policies as 0041 / tenantPolicies() in the Drizzle schema.
alter table lodging_night_notes enable row level security;
alter table lodging_night_notes force row level security;
drop policy if exists lodging_night_notes_tenant on lodging_night_notes;
drop policy if exists lodging_night_notes_system on lodging_night_notes;
create policy lodging_night_notes_tenant on lodging_night_notes for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy lodging_night_notes_system on lodging_night_notes for all to app_system
  using (true) with check (true);
grant select, insert, update, delete on lodging_night_notes to app_tenant, app_system;
