-- 0074_care_agent: the care agent, autonomy levels and "Rapiz đã mang lại" (spec 2026-11-11
-- care-agent-autonomy, ADR-031). The `brain` module owns the autonomy registry (autonomy_settings)
-- and gains the opt-out signal; the new `care` module owns its templates, enrollments, messages,
-- daily counter and its outbox position (care_checkpoints, global). Workspace-scoped tables use RLS
-- on app.workspace_id; worker ticks use app_system.
-- Additive only.

-- The customer asked not to be contacted (Brain evaluation output `optOut`): never enrolled.
ALTER TABLE conversation_signals ADD COLUMN opt_out boolean NOT NULL DEFAULT false;

-- Autonomy level per business and action; a missing row means the action's default level.
CREATE TABLE autonomy_settings (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  action text NOT NULL CONSTRAINT autonomy_settings_action_check
    CHECK (action IN ('care.send_message')),
  level text NOT NULL CONSTRAINT autonomy_settings_level_check
    CHECK (level IN ('suggest','act_and_report','auto')),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, action)
);

-- Per business and template: on/off, the owner's short instruction and parameters
-- (`afterSaleDays`). A missing row means the template's defaults.
CREATE TABLE care_templates (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  key text NOT NULL CONSTRAINT care_templates_key_check
    CHECK (key IN ('silent','ready','after_sale')),
  enabled boolean NOT NULL DEFAULT true,
  instruction text NOT NULL DEFAULT '' CONSTRAINT care_templates_instruction_length
    CHECK (char_length(instruction) <= 500),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, key)
);

-- One follow-up cycle per conversation and template. `anchor_at` is the customer message (or the
-- completed order/booking for after_sale) the cycle is for; a newer one restarts the cycle.
CREATE TABLE care_enrollments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  conversation_id uuid NOT NULL,
  template text NOT NULL CONSTRAINT care_enrollments_template_check
    CHECK (template IN ('silent','ready','after_sale')),
  step integer NOT NULL DEFAULT 0 CONSTRAINT care_enrollments_step_check CHECK (step >= 0),
  anchor_at timestamptz NOT NULL,
  next_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CONSTRAINT care_enrollments_status_check
    CHECK (status IN ('active','done','stopped')),
  stop_reason text CONSTRAINT care_enrollments_stop_reason_length
    CHECK (char_length(stop_reason) <= 40),
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT care_enrollments_conversation_fk FOREIGN KEY (workspace_id, conversation_id)
    REFERENCES conversations(workspace_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX care_enrollments_conversation_template_idx ON care_enrollments(
  workspace_id, conversation_id, template);
-- The worker's due scan (every 15 s, across businesses) reads only the active message templates.
CREATE INDEX care_enrollments_due_idx ON care_enrollments(next_at)
  WHERE status = 'active' AND template <> 'after_sale';
CREATE INDEX care_enrollments_after_sale_idx ON care_enrollments(workspace_id, next_at)
  WHERE status = 'active' AND template = 'after_sale';

-- Every message the agent wrote: a draft waiting for a person (suggest), or what it sent.
CREATE TABLE care_messages (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  conversation_id uuid NOT NULL,
  enrollment_id uuid,
  template text NOT NULL CONSTRAINT care_messages_template_check
    CHECK (template IN ('silent','ready','after_sale')),
  step integer NOT NULL DEFAULT 0,
  level text NOT NULL CONSTRAINT care_messages_level_check
    CHECK (level IN ('suggest','act_and_report','auto')),
  text text NOT NULL DEFAULT '' CONSTRAINT care_messages_text_length
    CHECK (char_length(text) <= 2000),
  skip_reason text CONSTRAINT care_messages_skip_reason_length
    CHECK (char_length(skip_reason) <= 200),
  status text NOT NULL CONSTRAINT care_messages_status_check
    CHECK (status IN ('draft','sending','sent','failed','expired','rejected','skipped')),
  window_closes_at timestamptz,
  sent_message_id uuid,
  sent_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  -- Cost of the model call that wrote it (token counts; the model's name).
  model text CONSTRAINT care_messages_model_length CHECK (char_length(model) <= 120),
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT care_messages_conversation_fk FOREIGN KEY (workspace_id, conversation_id)
    REFERENCES conversations(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX care_messages_conversation_idx ON care_messages(
  workspace_id, conversation_id, created_at DESC);
CREATE INDEX care_messages_draft_idx ON care_messages(workspace_id, created_at DESC)
  WHERE status = 'draft';
CREATE INDEX care_messages_sent_idx ON care_messages(workspace_id, sent_at DESC)
  WHERE status = 'sent';
-- The worker's expiry scan: drafts whose window closed, sends that never finished.
CREATE INDEX care_messages_open_idx ON care_messages(window_closes_at)
  WHERE status IN ('draft','sending');

-- Daily message counter per business (day in Asia/Ho_Chi_Minh), reserved before each model call.
CREATE TABLE care_usage (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  day date NOT NULL,
  count integer NOT NULL DEFAULT 0 CONSTRAINT care_usage_count_check CHECK (count >= 0),
  PRIMARY KEY (workspace_id, day)
);

-- The care module's outbox position (like brain_checkpoints). Global: app_system only, no RLS.
CREATE TABLE care_checkpoints (
  consumer text PRIMARY KEY,
  horizon bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON care_checkpoints FROM app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON care_checkpoints TO app_system;

ALTER TABLE autonomy_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE autonomy_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY autonomy_settings_tenant ON autonomy_settings FOR ALL TO app_tenant
  USING (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid))
  WITH CHECK (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid));
CREATE POLICY autonomy_settings_system ON autonomy_settings FOR ALL TO app_system
  USING (true) WITH CHECK (true);

ALTER TABLE care_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY care_templates_tenant ON care_templates FOR ALL TO app_tenant
  USING (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid))
  WITH CHECK (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid));
CREATE POLICY care_templates_system ON care_templates FOR ALL TO app_system
  USING (true) WITH CHECK (true);

ALTER TABLE care_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY care_enrollments_tenant ON care_enrollments FOR ALL TO app_tenant
  USING (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid))
  WITH CHECK (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid));
CREATE POLICY care_enrollments_system ON care_enrollments FOR ALL TO app_system
  USING (true) WITH CHECK (true);

ALTER TABLE care_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY care_messages_tenant ON care_messages FOR ALL TO app_tenant
  USING (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid))
  WITH CHECK (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid));
CREATE POLICY care_messages_system ON care_messages FOR ALL TO app_system
  USING (true) WITH CHECK (true);

ALTER TABLE care_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY care_usage_tenant ON care_usage FOR ALL TO app_tenant
  USING (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid))
  WITH CHECK (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid));
CREATE POLICY care_usage_system ON care_usage FOR ALL TO app_system
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON autonomy_settings, care_templates, care_enrollments, care_messages, care_usage
  TO app_tenant, app_system;
