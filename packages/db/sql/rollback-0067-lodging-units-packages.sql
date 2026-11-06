-- Reverse of migrations 0067_lodging_units_packages and 0068_lodging_bot_hold_draft_packages
-- (T-193). NOT a migration: the runner never applies this folder. Run it by hand before rolling
-- back past T-193 (docs/runbooks/deploy-vps.md, "Rolling back T-193 (migration 0067)").
-- The earlier release reads every weekday rate of a target as its price, so first the rates of
-- each target's full package (most bedrooms; ties: the later sort_order) become plain rates and
-- the other package rates are deleted. Then it drops the package links of rates and booking
-- units, the packages of bot hold drafts, the `lodging_packages` table and the unit detail
-- columns. Unit details, unit galleries and packages are lost; bookings and their units stay.
-- It can run again; it does not touch schema_migrations.

do $$
begin
  if to_regclass('lodging_packages') is not null then
    delete from lodging_rates
    where package_id is not null
      and package_id not in (
        select distinct on (property_id, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid)) id
        from lodging_packages
        order by property_id, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
          bedrooms desc, sort_order desc
      );
    update lodging_rates set package_id = null where package_id is not null;
  end if;
end
$$;

alter table lodging_rates drop column if exists package_id;
alter table lodging_booking_units drop column if exists package_id;
alter table lodging_bot_hold_drafts drop column if exists package_ids;
drop table if exists lodging_packages;

alter table lodging_units
  drop column if exists category,
  drop column if exists view,
  drop column if exists area_m2,
  drop column if exists description,
  drop column if exists amenities,
  drop column if exists max_guests,
  drop column if exists gallery,
  drop column if exists gallery_cover;
