-- 0041_lodging (T-160, spec 2026-11-01-lodging-calendar): lodging v2 tables — properties → units →
-- rates → bookings with one row per unit-night (the anti-double-booking key). Additive only:
-- products.accommodation and stay_requests (T-155) stay untouched and keep being served.

create table if not exists lodging_properties (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  code text not null,
  name text not null,
  area text not null default '',
  address text not null default '',
  description text not null default '',
  sell_mode text not null check (sell_mode in ('whole', 'rooms')),
  status text not null default 'active' check (status in ('active', 'paused')),
  standard_adults int not null check (standard_adults > 0),
  standard_children int not null default 0 check (standard_children >= 0),
  max_guests int check (max_guests is null or max_guests > 0),
  child_free_below int not null default 6,
  child_adult_from int not null default 12,
  amenities jsonb not null default '[]',
  layout jsonb not null default '[]',
  policies jsonb not null default '{}',
  gallery jsonb not null default '[]',
  extra_adult_sell bigint,
  extra_adult_cost bigint,
  extra_child_sell bigint,
  extra_child_cost bigint,
  -- T-155 product this property was copied from (0041 data copy); null for new properties.
  source_product_id uuid,
  sort_order int not null default 0,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lodging_properties_code_unique unique (workspace_id, code),
  constraint lodging_properties_ws_id unique (workspace_id, id)
);

create table if not exists lodging_units (
  id uuid primary key,
  workspace_id uuid not null,
  property_id uuid not null,
  kind text not null check (kind in ('whole', 'room')),
  name text not null,
  beds text not null default '',
  capacity_adults int not null default 1,
  capacity_children int not null default 0,
  active boolean not null default true,
  sort_order int not null default 0,
  constraint lodging_units_property_fk foreign key (workspace_id, property_id)
    references lodging_properties (workspace_id, id) on delete cascade,
  constraint lodging_units_ws_id unique (workspace_id, id)
);

create table if not exists lodging_rates (
  id uuid primary key,
  workspace_id uuid not null,
  property_id uuid not null,
  -- Null: the whole property; otherwise a room unit of a 'rooms' property.
  unit_id uuid,
  kind text not null check (kind in ('weekday', 'override')),
  -- ISO weekday: Monday = 1, Sunday = 7.
  weekdays int[] not null default '{}',
  date_from date,
  date_to date,
  label text not null default '',
  sell bigint not null check (sell >= 0),
  cost bigint not null check (cost >= 0),
  min_nights int,
  constraint lodging_rates_property_fk foreign key (workspace_id, property_id)
    references lodging_properties (workspace_id, id) on delete cascade,
  constraint lodging_rates_kind_dates check (
    (kind = 'weekday' and date_from is null)
    or (kind = 'override' and date_from is not null and date_to >= date_from)
  )
);
create index if not exists lodging_rates_property_idx on lodging_rates (workspace_id, property_id);

create table if not exists lodging_settings (
  workspace_id uuid primary key references workspaces(id),
  hold_minutes int not null default 120 check (hold_minutes between 15 and 1440),
  -- Last issued booking number; codes are 'BK-' || lpad(booking_seq, 4, '0').
  booking_seq int not null default 0
);

create table if not exists lodging_bookings (
  id uuid primary key,
  workspace_id uuid not null,
  property_id uuid not null,
  code text not null,
  kind text not null check (kind in ('stay', 'block')),
  whole boolean not null,
  status text not null,
  check_in date not null,
  check_out date not null,
  adults int not null default 0,
  child_ages int[] not null default '{}',
  guest_name text not null default '',
  guest_phone text not null default '',
  contact_id uuid,
  conversation_id uuid,
  source text,
  hold_expires_at timestamptz,
  quote jsonb,
  adjustment bigint not null default 0,
  adjustment_reason text not null default '',
  total_sell bigint,
  total_cost bigint,
  note text not null default '',
  block_reason text not null default '',
  client_request_id uuid not null,
  fingerprint text not null,
  created_by uuid,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lodging_bookings_property_fk foreign key (workspace_id, property_id)
    references lodging_properties (workspace_id, id),
  constraint lodging_bookings_code_unique unique (workspace_id, code),
  constraint lodging_bookings_request_unique unique (workspace_id, client_request_id),
  constraint lodging_bookings_ws_id unique (workspace_id, id),
  constraint lodging_bookings_valid_dates check (check_out > check_in and check_out - check_in <= 60),
  constraint lodging_bookings_kind_status check (
    (kind = 'stay' and status in ('hold', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'expired', 'no_show'))
    or (kind = 'block' and status in ('active', 'removed'))
  ),
  constraint lodging_bookings_hold_expiry check (status <> 'hold' or hold_expires_at is not null)
);
create index if not exists lodging_bookings_dates_idx
  on lodging_bookings (workspace_id, property_id, check_in, check_out);
create index if not exists lodging_bookings_hold_idx
  on lodging_bookings (workspace_id, hold_expires_at) where status = 'hold';
create index if not exists lodging_bookings_conversation_idx
  on lodging_bookings (workspace_id, conversation_id) where conversation_id is not null;

create table if not exists lodging_booking_units (
  workspace_id uuid not null,
  booking_id uuid not null,
  unit_id uuid not null,
  primary key (workspace_id, booking_id, unit_id),
  constraint lodging_booking_units_booking_fk foreign key (workspace_id, booking_id)
    references lodging_bookings (workspace_id, id) on delete cascade,
  constraint lodging_booking_units_unit_fk foreign key (workspace_id, unit_id)
    references lodging_units (workspace_id, id)
);

-- One row per occupied unit-night; the primary key is the single anti-double-booking rule.
create table if not exists lodging_unit_nights (
  workspace_id uuid not null,
  unit_id uuid not null,
  night date not null,
  booking_id uuid not null,
  primary key (workspace_id, unit_id, night),
  constraint lodging_unit_nights_booking_fk foreign key (workspace_id, booking_id)
    references lodging_bookings (workspace_id, id) on delete cascade,
  constraint lodging_unit_nights_unit_fk foreign key (workspace_id, unit_id)
    references lodging_units (workspace_id, id)
);
create index if not exists lodging_unit_nights_booking_idx on lodging_unit_nights (workspace_id, booking_id);

create table if not exists lodging_bot_properties (
  workspace_id uuid not null,
  bot_id uuid not null,
  property_id uuid not null,
  primary key (workspace_id, bot_id, property_id),
  constraint lodging_bot_properties_property_fk foreign key (workspace_id, property_id)
    references lodging_properties (workspace_id, id) on delete cascade
);

-- Forced RLS on every lodging table, same policies as tenantPolicies() in the Drizzle schema.
do $$
declare
  t text;
begin
  foreach t in array array[
    'lodging_properties', 'lodging_units', 'lodging_rates', 'lodging_settings',
    'lodging_bookings', 'lodging_booking_units', 'lodging_unit_nights', 'lodging_bot_properties'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_tenant', t);
    execute format('drop policy if exists %I on %I', t || '_system', t);
    execute format(
      'create policy %I on %I for all to app_tenant'
      ' using (workspace_id = (select nullif(current_setting(''app.workspace_id'', true), '''')::uuid))'
      ' with check (workspace_id = (select nullif(current_setting(''app.workspace_id'', true), '''')::uuid))',
      t || '_tenant', t);
    execute format(
      'create policy %I on %I for all to app_system using (true) with check (true)',
      t || '_system', t);
    execute format('grant select, insert, update, delete on %I to app_tenant, app_system', t);
  end loop;
end
$$;

-- Copies every T-155 accommodation product into lodging v2 (one whole unit, weekday rates,
-- bot links, confirmed stay requests as confirmed bookings). Idempotent: products already
-- copied (source_product_id) are skipped. Runs as the migration owner; app roles cannot call it.
-- Returns the number of properties created.
create or replace function lodging_copy_accommodations() returns integer
language plpgsql
as $$
declare
  p record;
  sr record;
  acc jsonb;
  v_prop_id uuid;
  v_unit_id uuid;
  prop_name text;
  prop_code text;
  hex text;
  v_adults int;
  v_children int;
  free_below int;
  seq int;
  copied int := 0;
begin
  for p in
    select pr.* from products pr
    where pr.accommodation is not null
      and jsonb_typeof(pr.accommodation) = 'object'
      and not exists (
        select 1 from lodging_properties lp
        where lp.workspace_id = pr.workspace_id and lp.source_product_id = pr.id
      )
    order by pr.workspace_id, pr.created_at, pr.id
  loop
    acc := p.accommodation;
    v_prop_id := gen_random_uuid();
    v_unit_id := gen_random_uuid();
    prop_name := coalesce(nullif(btrim(split_part(p.name, ' – ', 1)), ''), p.name);
    hex := upper(replace(p.id::text, '-', ''));
    -- Last hex digits: the random part of a UUIDv7 (the leading digits are a timestamp).
    prop_code := case when p.name ~* 'A17' then 'A17' else 'P' || right(hex, 6) end;
    if exists (
      select 1 from lodging_properties where workspace_id = p.workspace_id and code = prop_code
    ) then
      prop_code := 'P' || right(hex, 12);
    end if;
    v_adults := greatest(1, coalesce((acc->>'standardAdults')::int, 1));
    v_children := greatest(0, coalesce((acc->>'standardChildren')::int, 0));
    free_below := greatest(0, coalesce((acc->>'childAgeBelow')::int, 6));

    insert into lodging_properties (
      id, workspace_id, code, name, area, description, sell_mode, status,
      standard_adults, standard_children, max_guests, child_free_below, child_adult_from,
      amenities, layout, policies, gallery, source_product_id, created_at, updated_at
    ) values (
      v_prop_id, p.workspace_id, prop_code, prop_name,
      case when p.name like '%Tam Đảo%' then 'Sân golf Tam Đảo' else '' end,
      p.description, 'whole',
      case when p.status = 'active' then 'active' else 'paused' end,
      v_adults, v_children,
      case when (acc->>'maxGuests')::int > 0 then (acc->>'maxGuests')::int end,
      free_below, greatest(12, free_below),
      case when jsonb_typeof(acc->'amenities') = 'array' then acc->'amenities' else '[]'::jsonb end,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', coalesce(r->>'name', ''), 'beds', coalesce(r->>'beds', ''), 'note', '')
          order by ord)
        from jsonb_array_elements(
          case when jsonb_typeof(acc->'roomLayout') = 'array' then acc->'roomLayout' else '[]'::jsonb end
        ) with ordinality as l(r, ord)
      ), '[]'::jsonb),
      jsonb_build_object(
        'checkInTime', coalesce(acc->>'checkInOut', ''),
        'deposit', coalesce(acc->>'depositPolicy', ''),
        'cancellation', coalesce(acc->>'cancellationPolicy', ''),
        'other', btrim(coalesce(acc->>'extraGuestPolicy', '') || ' ' || coalesce(acc->>'holidayPolicy', ''))
      ),
      case when jsonb_typeof(acc->'gallery') = 'array' then acc->'gallery' else '[]'::jsonb end,
      p.id, p.created_at, p.updated_at
    );

    insert into lodging_units (id, workspace_id, property_id, kind, name, capacity_adults, capacity_children)
    values (v_unit_id, p.workspace_id, v_prop_id, 'whole', prop_name, v_adults, v_children);

    insert into lodging_rates (id, workspace_id, property_id, unit_id, kind, weekdays, sell, cost)
    select gen_random_uuid(), p.workspace_id, v_prop_id, null, 'weekday',
      array(select d::int from jsonb_array_elements_text(r->'days') as d),
      greatest(0, (r->>'amount')::bigint), greatest(0, (r->>'amount')::bigint)
    from jsonb_array_elements(
      case when jsonb_typeof(acc->'rates') = 'array' then acc->'rates' else '[]'::jsonb end
    ) as r
    where jsonb_typeof(r->'days') = 'array' and r->>'amount' is not null;

    -- Bots that sold this product: catalog 'all' bots of the workspace, or 'selected' with a row.
    insert into lodging_bot_properties (workspace_id, bot_id, property_id)
    select b.workspace_id, b.id, v_prop_id
    from bots b
    where b.workspace_id = p.workspace_id
      and b.deleted_at is null
      and (
        b.catalog_mode = 'all'
        or exists (
          select 1 from bot_products bp
          where bp.workspace_id = b.workspace_id and bp.bot_id = b.id and bp.product_id = p.id
        )
      )
    on conflict do nothing;

    -- Confirmed T-155 stay requests become confirmed bookings of the whole unit.
    for sr in
      select s.* from stay_requests s
      where s.workspace_id = p.workspace_id
        and s.property_id = p.id
        and s.status = 'confirmed'
        and s.check_out - s.check_in between 1 and 60
        and not exists (
          select 1 from lodging_bookings lb
          where lb.workspace_id = s.workspace_id
            and (lb.id = s.id or lb.client_request_id = s.client_request_id)
        )
      order by s.created_at, s.id
    loop
      insert into lodging_settings (workspace_id, booking_seq) values (p.workspace_id, 1)
      on conflict (workspace_id) do update set booking_seq = lodging_settings.booking_seq + 1
      returning booking_seq into seq;

      insert into lodging_bookings (
        id, workspace_id, property_id, code, kind, whole, status, check_in, check_out,
        adults, child_ages, guest_name, guest_phone, total_sell, total_cost, note,
        client_request_id, fingerprint, created_at, updated_at
      ) values (
        sr.id, sr.workspace_id, v_prop_id, 'BK-' || lpad(seq::text, 4, '0'), 'stay', true, 'confirmed',
        sr.check_in, sr.check_out,
        greatest(0, coalesce((sr.party->>'adults')::int, 0)),
        case when jsonb_typeof(sr.party->'childAges') = 'array'
          then array(select a::int from jsonb_array_elements_text(sr.party->'childAges') as a)
          else '{}'::int[] end,
        sr.guest_name, sr.guest_phone, sr.agreed_total, sr.agreed_total, sr.note,
        sr.client_request_id, sr.fingerprint, sr.created_at, sr.updated_at
      );
      insert into lodging_booking_units (workspace_id, booking_id, unit_id)
      values (sr.workspace_id, sr.id, v_unit_id);
      insert into lodging_unit_nights (workspace_id, unit_id, night, booking_id)
      select sr.workspace_id, v_unit_id, n::date, sr.id
      from generate_series(sr.check_in, sr.check_out - 1, interval '1 day') as n;
    end loop;

    copied := copied + 1;
  end loop;
  return copied;
end
$$;
revoke all on function lodging_copy_accommodations() from public;

select lodging_copy_accommodations();
