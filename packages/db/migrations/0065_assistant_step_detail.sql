-- 0065_assistant_step_detail: a debug detail per owner-assistant step (T-189), shown to the owner
-- under "Xem các bước". A model call keeps its token usage and the tools it asked for; a tool call
-- keeps its arguments and the start of its result, both PII-redacted and truncated by the app.
-- Additive only: older steps keep NULL.

ALTER TABLE assistant_run_steps
  ADD COLUMN detail jsonb CHECK (detail IS NULL OR octet_length(detail::text) <= 4096);
