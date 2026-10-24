-- T-045 review: terminal state for inbound Meta events that exhausted their attempts.
-- A dead-lettered row has processed_at (so it leaves the pending index) and failed_at set;
-- its payload stays for replay. Additive; existing rows keep their meaning.
alter table channel_webhook_events add column failed_at timestamptz;
