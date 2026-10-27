-- Website chat channel (T-099): per-connection settings (widget look, allowed domains)
-- and the 'website' provider / 'disabled' status. Additive: existing rows stay valid.
ALTER TABLE channel_connections ADD COLUMN settings jsonb;
ALTER TABLE channel_connections DROP CONSTRAINT channel_connections_provider_check;
ALTER TABLE channel_connections
  ADD CONSTRAINT channel_connections_provider_check CHECK (provider IN ('facebook', 'instagram', 'website'));
ALTER TABLE channel_connections DROP CONSTRAINT channel_connections_status_check;
ALTER TABLE channel_connections
  ADD CONSTRAINT channel_connections_status_check
  CHECK (status IN ('connected', 'disabled', 'reauth_required', 'disconnected'));
