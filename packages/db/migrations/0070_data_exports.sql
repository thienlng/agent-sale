-- 0070_data_exports: whole-workspace data exports (SET-10, spec 2026-11-08 Phase 2). One row per
-- export request; the worker claims queued rows with a lease, writes a ZIP to the private exports
-- bucket and marks it ready for 7 days. A one-time download link is stored as a SHA-256 hash.
-- Workspace-scoped (RLS on app.workspace_id); the worker and the link download use app_system.
-- Additive only.

CREATE TABLE data_exports (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  requested_by_user_id uuid NOT NULL,
  requested_by_name text CHECK (char_length(requested_by_name) <= 200),
  include_media boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','ready','failed','expired')),
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  object_key text CHECK (char_length(object_key) <= 300),
  size_bytes bigint,
  error_code text CHECK (char_length(error_code) <= 60),
  download_token_hash text CHECK (char_length(download_token_hash) = 64),
  download_token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  expires_at timestamptz
);
CREATE INDEX data_exports_workspace_idx ON data_exports(workspace_id, created_at DESC);
CREATE INDEX data_exports_queue_idx ON data_exports(created_at) WHERE status IN ('queued','running');
CREATE INDEX data_exports_expiry_idx ON data_exports(expires_at) WHERE status = 'ready';
CREATE UNIQUE INDEX data_exports_token_idx ON data_exports(download_token_hash)
  WHERE download_token_hash IS NOT NULL;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'assistant.report','assistant.alert','assistant.schedule_paused',
  'inbox.handoff','inbox.message','dataexport.ready','dataexport.failed'));

ALTER TABLE data_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_exports FORCE ROW LEVEL SECURITY;
CREATE POLICY data_exports_tenant ON data_exports FOR ALL TO app_tenant
  USING (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid))
  WITH CHECK (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid));
CREATE POLICY data_exports_system ON data_exports FOR ALL TO app_system
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON data_exports TO app_tenant, app_system;
