-- 0068_lodging_bot_hold_draft_packages: the bedroom packages of a bot hold draft (T-193).
-- The packages the customer saw in the hold summary; confirming books exactly these. No FK: a
-- draft lives 30 minutes, and a package removed meanwhile makes the confirm re-quote fail.
-- Expand-only (empty default). Reverse: packages/db/sql/rollback-0067-lodging-units-packages.sql,
-- which reverts T-193 as a whole. Safe to run again.
alter table lodging_bot_hold_drafts
  add column if not exists package_ids uuid[] not null default '{}';
