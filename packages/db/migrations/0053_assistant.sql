-- Owner assistant (ADR-021): account-scoped threads, messages, runs and their steps.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent() is STABLE; generated columns and indexes need an IMMUTABLE wrapper.
CREATE OR REPLACE FUNCTION assistant_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

CREATE TABLE assistant_threads (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 120),
  origin text NOT NULL DEFAULT 'chat' CHECK (origin IN ('chat','schedule','review')),
  business_id uuid REFERENCES workspaces(id),
  pinned boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  system_prompt text NOT NULL,
  prompt_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_threads_owner_idx
  ON assistant_threads(account_id, owner_user_id, archived, last_message_at DESC);

CREATE TABLE assistant_messages (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  owner_user_id uuid NOT NULL,
  thread_id uuid NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant','tool','event')),
  content text NOT NULL DEFAULT '',
  tool_calls jsonb,
  tool_call_id text,
  tool_name text,
  page_context jsonb,
  ui_actions jsonb NOT NULL DEFAULT '[]',
  run_id uuid,
  active boolean NOT NULL DEFAULT true,
  compacted boolean NOT NULL DEFAULT false,
  is_summary boolean NOT NULL DEFAULT false,
  search tsvector GENERATED ALWAYS AS (to_tsvector('simple', assistant_unaccent(content))) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_messages_seq_unique UNIQUE (thread_id, seq)
);
CREATE INDEX assistant_messages_search_idx ON assistant_messages USING gin(search);
CREATE INDEX assistant_messages_trgm_idx
  ON assistant_messages USING gin(assistant_unaccent(content) gin_trgm_ops);

CREATE TABLE assistant_runs (
  id uuid PRIMARY KEY,                       -- = client turn id (idempotent)
  account_id uuid NOT NULL REFERENCES accounts(id),
  owner_user_id uuid NOT NULL,
  thread_id uuid REFERENCES assistant_threads(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('chat','review','compaction','schedule','curator','title')),
  status text NOT NULL CHECK (status IN ('running','done','failed')),
  tier text NOT NULL, provider text, model text, prompt_version text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0, cached_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0, latency_ms integer NOT NULL DEFAULT 0,
  rounds integer NOT NULL DEFAULT 0, outcome text, guardrail text,
  created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE INDEX assistant_runs_owner_idx ON assistant_runs(account_id, owner_user_id, created_at DESC);
CREATE INDEX assistant_runs_running_idx ON assistant_runs(owner_user_id) WHERE status = 'running';

CREATE TABLE assistant_run_steps (
  run_id uuid NOT NULL REFERENCES assistant_runs(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id),
  kind text NOT NULL,
  tool_name text,
  ok boolean,
  ms integer,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, idx)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assistant_threads','assistant_messages','assistant_runs','assistant_run_steps'] LOOP
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
