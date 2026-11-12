-- 0078_purge_system_policies: fixes for the business purge (ADR-032).
--
-- 1. `fanpage_settings`, `fanpage_comments` (0024) and `stay_requests` (0035) have forced RLS with
--    only an `app_tenant` policy. Under `withSystem` a DELETE on them matched 0 rows without an
--    error, and deleting `channel_connections` / `products` then failed on the foreign key, so a
--    purge of a business with comments or stay requests threw on every run. They get the same
--    `<table>_system` policy as every other tenant table (FOR ALL TO app_system, true / true).
-- 2. Purge back-off: a business whose purge keeps failing waits longer between attempts and does
--    not block the others (`purge_attempts`, `purge_next_at`, `purge_last_error` = error class or
--    SQLSTATE only, never data).
-- 3. `status = 'purging'`: the purge claims the business atomically before it deletes anything; a
--    restore can then no longer win (and a run that died resumes, the row stays `purging`).
-- Additive only: three policies, three columns, one index replaced by a wider one.

create policy fanpage_settings_system on fanpage_settings for all to app_system using (true) with check (true);
create policy fanpage_comments_system on fanpage_comments for all to app_system using (true) with check (true);
create policy stay_requests_system on stay_requests for all to app_system using (true) with check (true);

ALTER TABLE workspaces ADD COLUMN purge_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN purge_next_at timestamptz;
ALTER TABLE workspaces ADD COLUMN purge_last_error text;

-- The purge queue: businesses waiting for their purge or in the middle of one.
CREATE INDEX workspaces_purge_queue_idx ON workspaces (purge_after)
  WHERE status IN ('pending_deletion', 'purging');
DROP INDEX IF EXISTS workspaces_purge_due_idx;
