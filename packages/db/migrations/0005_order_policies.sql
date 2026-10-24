-- 0005_order_policies: per-source order field policies and an optimistic-concurrency
-- version on order settings (T-024, docs/05 §6 "Order settings").
-- Backward compatible: new columns have defaults; an empty policy list means "source defaults".

alter table order_settings add column if not exists policies jsonb not null default '[]'::jsonb;
alter table order_settings add column if not exists version integer not null default 0;
