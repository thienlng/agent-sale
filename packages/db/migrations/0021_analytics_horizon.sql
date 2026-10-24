-- 0021_analytics_horizon: the projector's position is a transaction horizon, not an outbox id.
-- Outbox ids are handed out at insert and become visible at commit, in a different order, so "the
-- highest id seen" can skip a row that commits later. A transaction horizon (every transaction below
-- it has finished) cannot: the projector reads the rows of the transactions that finished since the
-- last horizon. Facts are idempotent, so replaying from 0 after this migration is safe.
alter table analytics_checkpoints add column if not exists horizon bigint not null default 0;
alter table analytics_checkpoints drop column if exists last_outbox_id;
delete from analytics_checkpoints;
