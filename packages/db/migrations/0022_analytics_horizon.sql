-- 0022_analytics_horizon: the projector's position is a transaction horizon, not an outbox id.
-- Outbox ids are handed out at insert and become visible at commit, in a different order, so "the
-- highest id seen" can skip a row that commits later. A transaction horizon (every transaction below
-- it has finished) cannot: the projector reads the rows of the transactions that finished since the
-- last horizon. Facts are idempotent, so replaying from 0 after this migration is safe.
alter table analytics_checkpoints add column if not exists horizon bigint not null default 0;
alter table analytics_checkpoints drop column if exists last_outbox_id;
delete from analytics_checkpoints;

-- Each outbox row records the 64-bit id of the transaction that wrote it. Unlike the 32-bit `xmin`
-- it never wraps (a rebuild replays everything, however old) and it can be indexed (a pass reads
-- only its window). Rows written before this migration all get this migration's id: they had
-- committed before it, so the first pass after it, starting from 0, takes them all.
alter table outbox_events add column if not exists tx_id xid8 not null default pg_current_xact_id();
create index if not exists outbox_events_tx_idx on outbox_events (tx_id);
