-- T-142: a removed page no longer owns its (provider, external_id); another business can connect it.
-- Backward compatible: existing data has at most one row per (provider, external_id) (the old
-- unique constraint), so the partial unique index cannot fail to build. The removed row keeps its
-- workspace, id and history.
ALTER TABLE channel_connections DROP CONSTRAINT IF EXISTS channel_connections_provider_external_id_key;
CREATE UNIQUE INDEX channel_connections_live_external_key
  ON channel_connections (provider, external_id) WHERE status <> 'removed';
