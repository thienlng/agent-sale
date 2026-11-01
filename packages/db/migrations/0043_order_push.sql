-- Order push to a PMS (ADR-017, PMS PR 2; additive).

-- A pushed order's stock belongs to the PMS: Rapiz moves none of it again (stock_state 'external').
alter table orders drop constraint if exists orders_stock_state_check;
alter table orders add constraint orders_stock_state_check
  check (stock_state in ('reserved', 'shipped', 'released', 'returned', 'external'));

-- One Rapiz order per PMS order; PMS webhooks look orders up by it.
create unique index if not exists orders_external on orders (workspace_id, external_source, external_id)
  where external_id is not null;
-- The push scan: orders not yet claimed, oldest first (it claims by created_at ascending).
create index if not exists orders_push_unclaimed_idx on orders (workspace_id, created_at)
  where external_state is null and deleted_at is null;
