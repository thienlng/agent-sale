-- Order push to a PMS (ADR-017, PMS PR 2; additive). Numbered 0050 to stay clear of the lodging
-- series (0041–0043…); PMS PR 3 takes 0051.

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
-- Claimed orders by claim age: the 15 s scan's stale re-queue (push on) or release (push off).
create index if not exists orders_push_pending_idx on orders (workspace_id, updated_at)
  where external_state = 'pending';

-- Push jobs by order: the scan reads each order's newest push job (`latestPushJob`) every 15 s.
create index if not exists integration_jobs_push_order_idx
  on integration_jobs (workspace_id, (payload ->> 'orderId'), created_at desc)
  where kind = 'push_order';
-- At most one open push job per order: two scans (two workers) can never queue a second one, so
-- an order is never sent twice at once. `enqueue` treats a conflict here as "already queued".
create unique index if not exists integration_jobs_one_push_per_order
  on integration_jobs (workspace_id, (payload ->> 'orderId'))
  where kind = 'push_order' and done_at is null and failed_at is null;
