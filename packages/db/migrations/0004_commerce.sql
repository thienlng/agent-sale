-- 0004_commerce: products with variants, warehouses, inventory with movements, orders with items and
-- status history, per-workspace order counter and settings (docs/05 §6, docs/02 ORD-01..05, ORD-11).
-- Money is bigint VND. All tables are tenant tables with forced RLS.

create table if not exists warehouses (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  name text not null,
  phone text,
  province text,
  ward text,
  address_detail text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists warehouses_workspace_idx on warehouses (workspace_id) where deleted_at is null;
-- At most one default warehouse per workspace.
create unique index if not exists warehouses_one_default on warehouses (workspace_id) where is_default and deleted_at is null;

create table if not exists products (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  code text not null,
  name text not null,
  description text not null default '',
  category text,
  status text not null default 'active' check (status in ('active', 'archived')),
  visible_to_bot boolean not null default true,
  -- folded (lowercase, no diacritics) code + name + SKUs, computed by the app; trigram-indexed
  search_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists products_code_unique on products (workspace_id, lower(code));
create index if not exists products_search_trgm on products using gin (search_text gin_trgm_ops);

create table if not exists product_variants (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  product_id uuid not null references products(id) on delete cascade,
  sku text not null,
  name text not null default '',
  price bigint not null check (price >= 0),
  cost bigint not null default 0 check (cost >= 0),
  weight_gram integer not null default 0 check (weight_gram >= 0),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists product_variants_sku_unique on product_variants (workspace_id, lower(sku)) where archived_at is null;
create index if not exists product_variants_product_idx on product_variants (product_id);

create table if not exists inventory (
  workspace_id uuid not null references workspaces(id),
  variant_id uuid not null references product_variants(id) on delete cascade,
  warehouse_id uuid not null references warehouses(id),
  on_hand integer not null default 0,
  reserved integer not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now(),
  primary key (variant_id, warehouse_id)
);
create index if not exists inventory_workspace_idx on inventory (workspace_id, warehouse_id);

-- Append-only log of every stock change (adjustments, order reserve/ship/release/return).
create table if not exists inventory_movements (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  variant_id uuid not null references product_variants(id) on delete cascade,
  warehouse_id uuid not null references warehouses(id),
  on_hand_delta integer not null,
  reserved_delta integer not null,
  reason text not null check (reason in ('adjust', 'reserve', 'release', 'ship', 'return')),
  ref_type text,
  ref_id uuid,
  actor_user_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists inventory_movements_variant_idx on inventory_movements (workspace_id, variant_id, created_at);

-- Display order codes increment per workspace (DH000001, DH000002, ...).
create table if not exists order_counters (
  workspace_id uuid primary key references workspaces(id),
  last_value bigint not null default 0
);

create table if not exists orders (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  code text not null,
  status text not null,
  -- where this order's goods are: reserved (held), shipped (left the warehouse), released, returned
  stock_state text not null check (stock_state in ('reserved', 'shipped', 'released', 'returned')),
  source text not null,
  warehouse_id uuid not null references warehouses(id),
  customer jsonb not null,
  recipient jsonb not null,
  expected_delivery_at timestamptz,
  item_qty integer not null,
  subtotal bigint not null,
  discount_type text not null check (discount_type in ('amount', 'percent')),
  discount_value bigint not null,
  discount_amount bigint not null,
  shipping_fee bigint not null,
  shipping_fee_charged bigint not null,
  free_shipping boolean not null default false,
  surcharge bigint not null,
  transfer_amount bigint not null,
  total bigint not null,
  paid bigint not null,
  remaining bigint not null,
  cod_amount bigint not null,
  cost_total bigint not null,
  carrier text,
  tracking_code text,
  note_internal text not null default '',
  note_print text not null default '',
  created_by_user_id uuid,
  -- name snapshot: users is a global table the tenant role cannot read
  created_by_name text,
  -- set by the client per order draft; a retried create returns the first order (no duplicates)
  client_request_id uuid,
  created_by_kind text not null default 'agent' check (created_by_kind in ('agent', 'bot', 'import', 'api')),
  placed_at timestamptz not null,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  search_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists orders_code_unique on orders (workspace_id, code);
create unique index if not exists orders_client_request_unique on orders (workspace_id, client_request_id) where client_request_id is not null;
create index if not exists orders_placed_idx on orders (workspace_id, placed_at desc) where deleted_at is null;
create index if not exists orders_status_idx on orders (workspace_id, status, placed_at desc) where deleted_at is null;
create index if not exists orders_search_trgm on orders using gin (search_text gin_trgm_ops);

create table if not exists order_items (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  order_id uuid not null references orders(id) on delete cascade,
  variant_id uuid not null references product_variants(id),
  product_name text not null,
  variant_name text not null,
  sku text not null,
  qty integer not null check (qty > 0),
  unit_price bigint not null,
  unit_cost bigint not null,
  line_total bigint not null,
  position integer not null default 0
);
create index if not exists order_items_order_idx on order_items (order_id);

create table if not exists order_status_history (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  order_id uuid not null references orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  note text,
  actor_user_id uuid,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists order_status_history_order_idx on order_status_history (order_id, created_at);

create table if not exists order_settings (
  workspace_id uuid primary key references workspaces(id),
  extra_statuses text[] not null default '{}',
  require_note_statuses text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table warehouses enable row level security;
alter table warehouses force row level security;
drop policy if exists warehouses_tenant on warehouses;
drop policy if exists warehouses_system on warehouses;
create policy warehouses_tenant on warehouses for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy warehouses_system on warehouses for all to app_system using (true) with check (true);

alter table products enable row level security;
alter table products force row level security;
drop policy if exists products_tenant on products;
drop policy if exists products_system on products;
create policy products_tenant on products for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy products_system on products for all to app_system using (true) with check (true);

alter table product_variants enable row level security;
alter table product_variants force row level security;
drop policy if exists product_variants_tenant on product_variants;
drop policy if exists product_variants_system on product_variants;
create policy product_variants_tenant on product_variants for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy product_variants_system on product_variants for all to app_system using (true) with check (true);

alter table inventory enable row level security;
alter table inventory force row level security;
drop policy if exists inventory_tenant on inventory;
drop policy if exists inventory_system on inventory;
create policy inventory_tenant on inventory for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy inventory_system on inventory for all to app_system using (true) with check (true);

alter table inventory_movements enable row level security;
alter table inventory_movements force row level security;
drop policy if exists inventory_movements_tenant on inventory_movements;
drop policy if exists inventory_movements_system on inventory_movements;
create policy inventory_movements_tenant on inventory_movements for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy inventory_movements_system on inventory_movements for all to app_system using (true) with check (true);

alter table order_counters enable row level security;
alter table order_counters force row level security;
drop policy if exists order_counters_tenant on order_counters;
drop policy if exists order_counters_system on order_counters;
create policy order_counters_tenant on order_counters for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy order_counters_system on order_counters for all to app_system using (true) with check (true);

alter table orders enable row level security;
alter table orders force row level security;
drop policy if exists orders_tenant on orders;
drop policy if exists orders_system on orders;
create policy orders_tenant on orders for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy orders_system on orders for all to app_system using (true) with check (true);

alter table order_items enable row level security;
alter table order_items force row level security;
drop policy if exists order_items_tenant on order_items;
drop policy if exists order_items_system on order_items;
create policy order_items_tenant on order_items for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy order_items_system on order_items for all to app_system using (true) with check (true);

alter table order_status_history enable row level security;
alter table order_status_history force row level security;
drop policy if exists order_status_history_tenant on order_status_history;
drop policy if exists order_status_history_system on order_status_history;
create policy order_status_history_tenant on order_status_history for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy order_status_history_system on order_status_history for all to app_system using (true) with check (true);

alter table order_settings enable row level security;
alter table order_settings force row level security;
drop policy if exists order_settings_tenant on order_settings;
drop policy if exists order_settings_system on order_settings;
create policy order_settings_tenant on order_settings for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy order_settings_system on order_settings for all to app_system using (true) with check (true);
