-- T-133: soft removal of Facebook/Instagram pages. Adds the `removed` status; the row, its
-- conversations and statistics stay. Existing rows and statuses stay valid (CHECK is widened only).
ALTER TABLE channel_connections DROP CONSTRAINT channel_connections_status_check;
ALTER TABLE channel_connections
  ADD CONSTRAINT channel_connections_status_check
  CHECK (status IN ('connected', 'disabled', 'reauth_required', 'disconnected', 'removed'));
