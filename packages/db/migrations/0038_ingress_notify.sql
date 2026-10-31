-- Wakes the agent worker when an ingress event is stored (additive).
-- The payload is only the row id: no tenant data travels in notifications.
-- Comments share channel_webhook_events, so one trigger covers messages and comments.
create or replace function rapiz_notify_ingress() returns trigger
language plpgsql as $$
begin
  perform pg_notify('rapiz_ingress', new.id::text);
  return new;
end;
$$;

drop trigger if exists channel_webhook_events_notify on channel_webhook_events;
create trigger channel_webhook_events_notify
  after insert on channel_webhook_events
  for each row execute function rapiz_notify_ingress();
