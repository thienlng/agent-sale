-- 0072_business_brain: Business Brain v1 and the Today screen (spec 2026-11-11, ADR-030).
-- The `brain` module stores one AI judgement per conversation (conversation_signals), the idle
-- evaluation queue (signal_jobs), per-run metering (signal_runs), the daily evaluation counter
-- (signal_usage) and per-business settings (brain_settings). The `crm` module gains `tasks`
-- (CRM-04). Workspace-scoped (RLS on app.workspace_id); worker ticks use app_system.
-- Additive only.

-- One row per conversation. Deleting the conversation deletes its signals; a deleted customer
-- only clears the link (the conversation keeps its own signals).
CREATE TABLE conversation_signals (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  conversation_id uuid NOT NULL,
  contact_id uuid,
  stage text NOT NULL DEFAULT 'new' CONSTRAINT conversation_signals_stage_check
    CHECK (stage IN ('new','exploring','price_asked','ready','won','after_sale','lost','spam')),
  intent text CONSTRAINT conversation_signals_intent_length CHECK (char_length(intent) <= 160),
  mood text NOT NULL DEFAULT 'neutral' CONSTRAINT conversation_signals_mood_check
    CHECK (mood IN ('positive','neutral','negative','complaint')),
  needs_human boolean NOT NULL DEFAULT false,
  needs_human_reason text CONSTRAINT conversation_signals_needs_human_reason_length
    CHECK (char_length(needs_human_reason) <= 200),
  follow_up_at timestamptz,
  follow_up_reason text CONSTRAINT conversation_signals_follow_up_reason_length
    CHECK (char_length(follow_up_reason) <= 200),
  note text CONSTRAINT conversation_signals_note_length CHECK (char_length(note) <= 1500),
  evaluated_until timestamptz,
  evaluated_at timestamptz,
  stage_locked boolean NOT NULL DEFAULT false,
  dismissed_until_message_after timestamptz,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, conversation_id),
  CONSTRAINT conversation_signals_conversation_fk FOREIGN KEY (workspace_id, conversation_id)
    REFERENCES conversations(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT conversation_signals_contact_fk FOREIGN KEY (workspace_id, contact_id)
    REFERENCES contacts(workspace_id, id) ON DELETE SET NULL (contact_id)
);
CREATE INDEX conversation_signals_stage_idx ON conversation_signals(workspace_id, stage);
CREATE INDEX conversation_signals_follow_up_idx ON conversation_signals(workspace_id, follow_up_at);

-- Idle evaluation queue: one row per conversation; a newer customer message pushes run_after back.
CREATE TABLE signal_jobs (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  conversation_id uuid NOT NULL,
  trigger text NOT NULL CONSTRAINT signal_jobs_trigger_check
    CHECK (trigger IN ('idle','manual','refresh')),
  run_after timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CONSTRAINT signal_jobs_status_check
    CHECK (status IN ('pending','capped')),
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, conversation_id),
  CONSTRAINT signal_jobs_conversation_fk FOREIGN KEY (workspace_id, conversation_id)
    REFERENCES conversations(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX signal_jobs_due_idx ON signal_jobs(run_after) WHERE status = 'pending';

-- One row per evaluation call, for cost reporting (ai_runs stays bot-only). History: no key to
-- conversations, like ai_runs.
CREATE TABLE signal_runs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  conversation_id uuid NOT NULL,
  trigger text NOT NULL CONSTRAINT signal_runs_trigger_check
    CHECK (trigger IN ('idle','manual','refresh')),
  tier text NOT NULL CONSTRAINT signal_runs_tier_length CHECK (char_length(tier) <= 40),
  model text CONSTRAINT signal_runs_model_length CHECK (char_length(model) <= 120),
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  outcome text NOT NULL CONSTRAINT signal_runs_outcome_check
    CHECK (outcome IN ('ok','invalid','error','timeout')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signal_runs_workspace_idx ON signal_runs(workspace_id, created_at DESC);

-- Daily evaluation counter per business (day in Asia/Ho_Chi_Minh), reserved before each call.
CREATE TABLE signal_usage (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  day date NOT NULL,
  count integer NOT NULL DEFAULT 0 CONSTRAINT signal_usage_count_check CHECK (count >= 0),
  PRIMARY KEY (workspace_id, day)
);

-- Per-business settings; a missing row means the defaults below.
CREATE TABLE brain_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id),
  mode text NOT NULL DEFAULT 'auto' CONSTRAINT brain_settings_mode_check
    CHECK (mode IN ('auto','manual')),
  idle_minutes integer NOT NULL DEFAULT 45 CONSTRAINT brain_settings_idle_minutes_check
    CHECK (idle_minutes BETWEEN 30 AND 120),
  briefing_enabled boolean NOT NULL DEFAULT true,
  briefing_hour integer NOT NULL DEFAULT 8 CONSTRAINT brain_settings_briefing_hour_check
    CHECK (briefing_hour BETWEEN 0 AND 23),
  last_briefing_day date
);

-- CRM tasks (CRM-04). Links are opaque ids; only the customer link is a same-workspace key, and a
-- deleted customer deletes its tasks.
CREATE TABLE tasks (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  title text NOT NULL CONSTRAINT tasks_title_length
    CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 200),
  note text CONSTRAINT tasks_note_length CHECK (char_length(note) <= 2000),
  due_at timestamptz,
  assignee_kind text NOT NULL DEFAULT 'member' CONSTRAINT tasks_assignee_kind_check
    CHECK (assignee_kind IN ('member','ai')),
  assignee_user_id uuid,
  status text NOT NULL DEFAULT 'open' CONSTRAINT tasks_status_check
    CHECK (status IN ('open','done','cancelled')),
  done_at timestamptz,
  done_by uuid,
  contact_id uuid,
  conversation_id uuid,
  subject_type text CONSTRAINT tasks_subject_type_length CHECK (char_length(subject_type) <= 40),
  subject_id uuid,
  source text NOT NULL DEFAULT 'manual' CONSTRAINT tasks_source_check
    CHECK (source IN ('manual','today','assistant')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  reminded_at timestamptz,
  CONSTRAINT tasks_subject_check CHECK ((subject_type IS NULL) = (subject_id IS NULL)),
  CONSTRAINT tasks_contact_fk FOREIGN KEY (workspace_id, contact_id)
    REFERENCES contacts(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX tasks_status_due_idx ON tasks(workspace_id, status, due_at);
CREATE INDEX tasks_open_assignee_idx ON tasks(workspace_id, assignee_user_id) WHERE status = 'open';
CREATE INDEX tasks_contact_idx ON tasks(workspace_id, contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE conversation_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_signals FORCE ROW LEVEL SECURITY;
CREATE POLICY conversation_signals_tenant ON conversation_signals FOR ALL TO app_tenant
  USING (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid))
  WITH CHECK (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid));
CREATE POLICY conversation_signals_system ON conversation_signals FOR ALL TO app_system
  USING (true) WITH CHECK (true);

ALTER TABLE signal_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY signal_jobs_tenant ON signal_jobs FOR ALL TO app_tenant
  USING (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid))
  WITH CHECK (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid));
CREATE POLICY signal_jobs_system ON signal_jobs FOR ALL TO app_system
  USING (true) WITH CHECK (true);

ALTER TABLE signal_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY signal_runs_tenant ON signal_runs FOR ALL TO app_tenant
  USING (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid))
  WITH CHECK (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid));
CREATE POLICY signal_runs_system ON signal_runs FOR ALL TO app_system
  USING (true) WITH CHECK (true);

ALTER TABLE signal_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY signal_usage_tenant ON signal_usage FOR ALL TO app_tenant
  USING (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid))
  WITH CHECK (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid));
CREATE POLICY signal_usage_system ON signal_usage FOR ALL TO app_system
  USING (true) WITH CHECK (true);

ALTER TABLE brain_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY brain_settings_tenant ON brain_settings FOR ALL TO app_tenant
  USING (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid))
  WITH CHECK (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid));
CREATE POLICY brain_settings_system ON brain_settings FOR ALL TO app_system
  USING (true) WITH CHECK (true);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tasks_tenant ON tasks FOR ALL TO app_tenant
  USING (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid))
  WITH CHECK (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid));
CREATE POLICY tasks_system ON tasks FOR ALL TO app_system
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON conversation_signals, signal_jobs, signal_runs, signal_usage, brain_settings, tasks
  TO app_tenant, app_system;

-- Notification types of Business Brain v1: the morning briefing, a complaint alert and a due task.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'assistant.report','assistant.alert','assistant.schedule_paused',
  'inbox.handoff','inbox.message','dataexport.ready','dataexport.failed',
  'today.briefing','brain.complaint','task.due'));
