-- 0077_workspace_deletion: business (workspace) deletion (ADR-032, SET-10). The owner asks to delete
-- a business: `status` becomes 'pending_deletion', `deleted_at` is set and `purge_after` is 30 days
-- later; restoring before then clears all three. A worker purge (app_system, ADR-004 amendment
-- 2026-11-12) hard-deletes every row of the business after `purge_after`, then leaves the
-- `workspaces` row as a tombstone (`status = 'deleted'`, `purged_at`, name and profile erased) so
-- the append-only `audit_events` rows and the account-scoped references keep their foreign key.
-- Additive only: two nullable columns, one partial index, explicit grants for the purge.

ALTER TABLE workspaces ADD COLUMN purge_after timestamptz;
ALTER TABLE workspaces ADD COLUMN purged_at timestamptz;

-- The purge scan: businesses whose restore window ended.
CREATE INDEX workspaces_purge_due_idx ON workspaces (purge_after)
  WHERE status = 'pending_deletion';

-- The purge deletes through app_system. Every table with a `workspace_id` column already grants
-- it DELETE except `audit_events` (append-only, kept on purpose); this makes the grant explicit for
-- every such table that exists today. A later table must grant it in its own migration; the purge
-- integration test fails when one does not.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND a.attname = 'workspace_id' AND NOT a.attisdropped
      AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND c.relname <> 'audit_events'
  LOOP
    EXECUTE format('GRANT SELECT, DELETE ON %I TO app_system', t);
  END LOOP;
END $$;
