-- Owner assistant 1c (ADR-024): owner, learned and shadow skills with an append-only ledger,
-- proactive suggestions, per-owner settings, Postgres-leased background jobs (review, curator),
-- 👍/👎 feedback on answers and the review trigger counters. Additive only.

CREATE TABLE assistant_skills (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9-]*$' AND char_length(name) <= 64),
  description text NOT NULL CHECK (char_length(description) <= 120),
  body text NOT NULL CHECK (char_length(body) <= 8000),
  toolsets text[] NOT NULL DEFAULT '{}',
  provenance text NOT NULL CHECK (provenance IN ('owner','learned','shadow')),
  shadow_of text,                -- the platform skill a shadow replaces; NULL unless shadow
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('pending_approval','active','stale','archived')),
  pinned boolean NOT NULL DEFAULT false,
  use_count integer NOT NULL DEFAULT 0,
  view_count integer NOT NULL DEFAULT 0,
  patch_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  last_patched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Millisecond precision: it is the optimistic-concurrency token a JS Date round-trips exactly.
  updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  CONSTRAINT assistant_skills_shadow_check CHECK ((provenance = 'shadow') = (shadow_of IS NOT NULL))
);
CREATE UNIQUE INDEX assistant_skills_name_unique
  ON assistant_skills(account_id, owner_user_id, name) WHERE state <> 'archived';

CREATE TABLE assistant_skill_events (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  owner_user_id uuid NOT NULL,
  skill_id uuid NOT NULL REFERENCES assistant_skills(id) ON DELETE CASCADE,
  actor text NOT NULL CHECK (actor IN ('owner','assistant','review','curator')),
  action text NOT NULL
    CHECK (action IN ('create','patch','archive','restore','approve','reject','undo')),
  before jsonb,                  -- { name, description, body, state } or NULL (create)
  after jsonb,
  run_id uuid,
  undone_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_skill_events_owner_idx
  ON assistant_skill_events(account_id, owner_user_id, created_at);
CREATE INDEX assistant_skill_events_skill_idx ON assistant_skill_events(skill_id, created_at);

CREATE TABLE assistant_suggestions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('schedule','skill','setup')),
  dedup_key text NOT NULL CHECK (char_length(dedup_key) <= 120),
  title text NOT NULL CHECK (char_length(title) <= 200),
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  -- A dismissal is permanent: the key stays taken whatever the status.
  CONSTRAINT assistant_suggestions_dedup_unique UNIQUE (account_id, owner_user_id, dedup_key)
);

CREATE TABLE assistant_settings (
  account_id uuid NOT NULL REFERENCES accounts(id),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  review_enabled boolean NOT NULL DEFAULT true,
  disabled_toolsets text[] NOT NULL DEFAULT '{}',
  curator_ran_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, owner_user_id)
);

CREATE TABLE assistant_jobs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  owner_user_id uuid NOT NULL,
  thread_id uuid REFERENCES assistant_threads(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('review','curator')),
  review_scope text CHECK (review_scope IN ('memory','skills','combined')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','done','failed','cancelled')),
  run_after timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT assistant_jobs_scope_check CHECK ((kind = 'review') = (review_scope IS NOT NULL))
);
CREATE INDEX assistant_jobs_status_idx ON assistant_jobs(status, run_after);
-- At most one queued job per owner, thread and kind (a curator job has no thread).
CREATE UNIQUE INDEX assistant_jobs_queued_unique
  ON assistant_jobs(account_id, owner_user_id, kind, thread_id) NULLS NOT DISTINCT
  WHERE status = 'queued';

ALTER TABLE assistant_messages
  ADD COLUMN feedback smallint CHECK (feedback IN (-1, 1));

ALTER TABLE assistant_threads
  ADD COLUMN review_owner_turns integer NOT NULL DEFAULT 0,
  ADD COLUMN review_tool_rounds integer NOT NULL DEFAULT 0,
  ADD COLUMN last_review_at timestamptz;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assistant_skills','assistant_skill_events','assistant_suggestions',
                           'assistant_settings','assistant_jobs'] LOOP
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
