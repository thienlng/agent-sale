-- Shop-bot turn traces (T-174, bot doctor): one ai_run_traces row per ai_runs row and the
-- loop's steps in ai_run_steps. Tenant tables with forced RLS, kept 30 days (AiTraceRunner
-- purges them; ai_runs keeps its own retention). Excerpts and details are redacted and
-- allowlisted by the app. Additive only. Spec 2026-11-02-owner-assistant-doctor-design §4.

CREATE TABLE ai_run_traces (
  run_id uuid PRIMARY KEY REFERENCES ai_runs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  conversation_id uuid,
  started_at timestamptz NOT NULL,
  channel text,
  comment_reply boolean NOT NULL DEFAULT false,
  history_turns smallint NOT NULL DEFAULT 0,
  history_summarized boolean NOT NULL DEFAULT false,
  customer_images smallint NOT NULL DEFAULT 0,
  query_excerpt text CHECK (char_length(query_excerpt) <= 300),
  reply_excerpt text CHECK (char_length(reply_excerpt) <= 300),
  scenario_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_array_length(scenario_ids) <= 50),
  focus_product_ids jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_array_length(focus_product_ids) <= 3),
  action_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_array_length(action_ids) <= 20),
  pending_action boolean NOT NULL DEFAULT false,
  offered_tools text[] NOT NULL DEFAULT '{}',
  system_prompt_sha char(64) NOT NULL,
  situations_sha char(64) NOT NULL,
  model_calls smallint NOT NULL DEFAULT 0,
  loop_outcome text NOT NULL
    CHECK (loop_outcome IN ('done','interrupted','limit','invalid_tools','budget','error')),
  messages_sent smallint NOT NULL DEFAULT 0,
  messages_undelivered smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_run_traces_bot_idx ON ai_run_traces (workspace_id, bot_id, created_at DESC);
CREATE INDEX ai_run_traces_conversation_idx
  ON ai_run_traces (workspace_id, conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;
CREATE INDEX ai_run_traces_created_idx ON ai_run_traces (created_at);
-- Accent-insensitive substring search over both excerpts (the `q` filter of GET /bots/{id}/turns).
CREATE INDEX ai_run_traces_q_idx ON ai_run_traces
  USING gin (assistant_unaccent(coalesce(query_excerpt, '') || ' ' || coalesce(reply_excerpt, ''))
    gin_trgm_ops);

CREATE TABLE ai_run_steps (
  run_id uuid NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  idx smallint NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  kind text NOT NULL,
  tool_name text,
  ok boolean,
  error_code text CHECK (char_length(error_code) <= 60),
  ms integer,
  detail jsonb CHECK (char_length(detail::text) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, idx)
);
CREATE INDEX ai_run_steps_created_idx ON ai_run_steps (created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_run_traces', 'ai_run_steps'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_system', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO app_tenant '
      'USING (workspace_id = (SELECT nullif(current_setting(''app.workspace_id'', true), '''')::uuid)) '
      'WITH CHECK (workspace_id = (SELECT nullif(current_setting(''app.workspace_id'', true), '''')::uuid))',
      t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO app_system USING (true) WITH CHECK (true)',
      t || '_system', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_tenant, app_system', t);
  END LOOP;
END $$;

-- The id of the row an approved proposal created (a 2xx JSON response body's uuid `id`).
ALTER TABLE assistant_proposals ADD COLUMN IF NOT EXISTS result_id uuid;
