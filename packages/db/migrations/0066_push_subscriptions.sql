-- 0066_push_subscriptions: Web Push devices of a user (T-190, installable app / PWA). One row per
-- browser push endpoint and account; the notification module's push channel sends to every row
-- of the recipient and deletes a row the push service reports gone (404/410). Account-scoped like
-- notifications (RLS on app.account_id); every query also filters on user_id. Additive only.

CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL CHECK (char_length(endpoint) <= 1000 AND endpoint LIKE 'https://%'),
  p256dh text NOT NULL CHECK (char_length(p256dh) <= 200),
  auth text NOT NULL CHECK (char_length(auth) <= 100),
  user_agent text CHECK (char_length(user_agent) <= 200),
  failures integer NOT NULL DEFAULT 0,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (account_id, endpoint)
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions(account_id, user_id);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'assistant.report','assistant.alert','assistant.schedule_paused',
  'inbox.handoff','inbox.message'));

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY push_subscriptions_account ON push_subscriptions FOR ALL TO app_tenant
  USING (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid))
  WITH CHECK (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid));
CREATE POLICY push_subscriptions_system ON push_subscriptions FOR ALL TO app_system
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO app_tenant, app_system;
