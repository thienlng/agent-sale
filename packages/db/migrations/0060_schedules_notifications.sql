-- Owner assistant capability 3 (T-172, ADR-023): code-computed scheduled reports and alerts
-- (`assistant_schedules`, `assistant_schedule_runs`), schedule proposals, and the tier-0
-- `notification` module (`notifications`, `notification_deliveries`). Additive only.

CREATE TABLE assistant_schedules (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  business_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL CHECK (char_length(name) <= 80),
  template text NOT NULL CHECK (template IN
    ('revenue_summary','new_orders','low_stock','unanswered_conversations','new_customers')),
  mode text NOT NULL CHECK (mode IN ('report','alert')),
  params jsonb NOT NULL DEFAULT '{}',
  cadence jsonb NOT NULL,
  channels text[] NOT NULL DEFAULT ARRAY['in_app'],
  commentary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  paused_reason text
    CHECK (paused_reason IN ('owner','failures','business_unavailable','owner_not_active')),
  next_run_at timestamptz,
  run_requested_at timestamptz,
  lease_until timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  last_checked_at timestamptz,
  alert_fingerprint text,
  last_alerted_at timestamptz,
  alert_cursor timestamptz,
  created_by text NOT NULL CHECK (created_by IN ('owner','assistant','suggestion')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Millisecond precision: the optimistic-concurrency token a JS Date round-trips exactly.
  updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  CONSTRAINT assistant_schedules_channels_check
    CHECK (channels <@ ARRAY['in_app','email','push'] AND 'in_app' = ANY(channels)),
  CONSTRAINT assistant_schedules_mode_template_check
    CHECK (mode = 'report' OR template IN ('new_orders','low_stock','unanswered_conversations'))
);
CREATE INDEX assistant_schedules_due_idx ON assistant_schedules(status, next_run_at);
CREATE INDEX assistant_schedules_requested_idx ON assistant_schedules(status, run_requested_at)
  WHERE run_requested_at IS NOT NULL;
CREATE INDEX assistant_schedules_owner_idx ON assistant_schedules(account_id, owner_user_id);

CREATE TABLE assistant_schedule_runs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  owner_user_id uuid NOT NULL,
  schedule_id uuid NOT NULL REFERENCES assistant_schedules(id) ON DELETE CASCADE,
  trigger text NOT NULL CHECK (trigger IN ('cadence','manual')),
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','done','failed','blocked','skipped')),
  error_code text,
  report jsonb CHECK (report IS NULL OR octet_length(report::text) <= 16384),
  title text,
  body text,
  commentary_run_id uuid,
  notification_id uuid,
  thread_id uuid REFERENCES assistant_threads(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT assistant_schedule_runs_slot_unique UNIQUE (schedule_id, scheduled_for)
);
CREATE INDEX assistant_schedule_runs_owner_idx
  ON assistant_schedule_runs(account_id, owner_user_id, schedule_id, started_at DESC);
CREATE INDEX assistant_schedule_runs_started_idx ON assistant_schedule_runs(started_at);

-- Shared with capability 4 (product import): identical statements on both branches, so either
-- migration order leaves the same constraint.
ALTER TABLE assistant_proposals ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'route';
ALTER TABLE assistant_proposals DROP CONSTRAINT IF EXISTS assistant_proposals_kind_check;
ALTER TABLE assistant_proposals ADD CONSTRAINT assistant_proposals_kind_check
  CHECK (kind IN ('route','schedule','product_import'));

CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  user_id uuid NOT NULL REFERENCES users(id),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  type text NOT NULL
    CHECK (type IN ('assistant.report','assistant.alert','assistant.schedule_paused')),
  params jsonb NOT NULL DEFAULT '{}',
  title text NOT NULL CHECK (char_length(title) <= 160),
  body text NOT NULL CHECK (char_length(body) <= 4000),
  target jsonb,
  dedup_key text CHECK (char_length(dedup_key) <= 160),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_list_idx
  ON notifications(account_id, user_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread_idx ON notifications(account_id, user_id) WHERE read_at IS NULL;
CREATE UNIQUE INDEX notifications_dedup_unique ON notifications(user_id, dedup_key)
  WHERE dedup_key IS NOT NULL;
CREATE INDEX notifications_created_idx ON notifications(created_at);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  user_id uuid NOT NULL REFERENCES users(id),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email','push')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sending','sent','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  error_code text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_deliveries_channel_unique UNIQUE (notification_id, channel)
);
CREATE INDEX notification_deliveries_due_idx ON notification_deliveries(status, next_attempt_at);
CREATE INDEX notification_deliveries_sent_idx ON notification_deliveries(user_id, channel, sent_at)
  WHERE status = 'sent';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assistant_schedules','assistant_schedule_runs',
                           'notifications','notification_deliveries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR ALL TO app_tenant
      USING (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid))
      WITH CHECK (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid))$p$,
      t || '_account', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO app_system USING (true) WITH CHECK (true)', t || '_system', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_tenant, app_system', t);
  END LOOP;
END $$;
