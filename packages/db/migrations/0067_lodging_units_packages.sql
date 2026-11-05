-- 0067_lodging_units_packages: units with their own details, and bedroom packages (T-193).
-- Expand-only: every new column has a default or is nullable, so existing rows keep working and
-- need no backfill. A package is a priced variant of one rental target: the whole property
-- (`unit_id` null, same convention as `lodging_rates.unit_id`) or one unit. Occupancy is
-- unchanged: a booking still takes the nights of its units. Reverse:
-- packages/db/sql/rollback-0067-lodging-units-packages.sql. Safe to run again.

-- ── Unit details ─────────────────────────────────────────────────────────────
-- `category` is ignored for the `whole` unit. `max_guests` null = no hard maximum. `gallery` is
-- the T-192 folder shape; `gallery_cover` '' = automatic, as on the property.
alter table lodging_units
  add column if not exists category text not null default 'room',
  add column if not exists view text not null default '',
  add column if not exists area_m2 integer,
  add column if not exists description text not null default '',
  add column if not exists amenities jsonb not null default '[]'::jsonb,
  add column if not exists max_guests integer,
  add column if not exists gallery jsonb not null default '[]'::jsonb,
  add column if not exists gallery_cover text not null default '';

alter table lodging_units
  drop constraint if exists lodging_units_category_check,
  add constraint lodging_units_category_check
    check (category in ('room', 'bungalow', 'house', 'other')),
  drop constraint if exists lodging_units_view_check,
  add constraint lodging_units_view_check check (char_length(view) <= 200),
  drop constraint if exists lodging_units_area_m2_check,
  add constraint lodging_units_area_m2_check check (area_m2 between 1 and 100000),
  drop constraint if exists lodging_units_description_check,
  add constraint lodging_units_description_check check (char_length(description) <= 2000),
  drop constraint if exists lodging_units_amenities_check,
  add constraint lodging_units_amenities_check
    check (jsonb_typeof(amenities) = 'array' and jsonb_array_length(amenities) <= 40),
  drop constraint if exists lodging_units_max_guests_check,
  add constraint lodging_units_max_guests_check check (max_guests between 1 and 2000),
  drop constraint if exists lodging_units_gallery_check,
  add constraint lodging_units_gallery_check check (jsonb_typeof(gallery) = 'array');

-- ── Packages ─────────────────────────────────────────────────────────────────
create table if not exists lodging_packages (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  property_id uuid not null,
  -- Null: the whole property; otherwise one unit of the property.
  unit_id uuid,
  name text not null check (char_length(name) between 1 and 50),
  bedrooms integer not null check (bedrooms between 1 and 100),
  standard_adults integer not null check (standard_adults between 1 and 1000),
  standard_children integer not null default 0 check (standard_children between 0 and 1000),
  max_guests integer check (max_guests between 1 and 2000),
  sort_order integer not null default 0,
  constraint lodging_packages_property_fk foreign key (workspace_id, property_id)
    references lodging_properties (workspace_id, id) on delete cascade,
  -- MATCH SIMPLE: a null unit_id (whole-property package) is not checked.
  constraint lodging_packages_unit_fk foreign key (workspace_id, unit_id)
    references lodging_units (workspace_id, id) on delete cascade,
  constraint lodging_packages_ws_id unique (workspace_id, id)
);
create index if not exists lodging_packages_property_idx on lodging_packages (property_id);
-- One name per (property, target), case-insensitive; the zero uuid stands for the whole property.
create unique index if not exists lodging_packages_name_unique on lodging_packages
  (property_id, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- Forced RLS, same policies as 0041 / tenantPolicies() in the Drizzle schema.
alter table lodging_packages enable row level security;
alter table lodging_packages force row level security;
drop policy if exists lodging_packages_tenant on lodging_packages;
drop policy if exists lodging_packages_system on lodging_packages;
create policy lodging_packages_tenant on lodging_packages for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy lodging_packages_system on lodging_packages for all to app_system
  using (true) with check (true);
grant select, insert, update, delete on lodging_packages to app_tenant, app_system;

-- ── Package of a rate and of a booking unit ──────────────────────────────────
-- A rate belongs to its package (deleted with it). A booking unit only remembers which package
-- was sold: deleting the package clears `package_id` and keeps the booking (Postgres 15+ column
-- list, so `workspace_id` stays set).
alter table lodging_rates add column if not exists package_id uuid;
alter table lodging_rates
  drop constraint if exists lodging_rates_package_fk,
  add constraint lodging_rates_package_fk foreign key (workspace_id, package_id)
    references lodging_packages (workspace_id, id) on delete cascade;
create index if not exists lodging_rates_package_idx on lodging_rates (workspace_id, package_id)
  where package_id is not null;

alter table lodging_booking_units add column if not exists package_id uuid;
alter table lodging_booking_units
  drop constraint if exists lodging_booking_units_package_fk,
  add constraint lodging_booking_units_package_fk foreign key (workspace_id, package_id)
    references lodging_packages (workspace_id, id) on delete set null (package_id);
create index if not exists lodging_booking_units_package_idx
  on lodging_booking_units (workspace_id, package_id) where package_id is not null;
