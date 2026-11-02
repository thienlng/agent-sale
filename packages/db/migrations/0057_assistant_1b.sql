-- Owner assistant 1b (ADR-023): bounded memory, write proposals awaiting the owner's approval,
-- and the columns auto-compaction needs. Additive only.

CREATE TABLE assistant_memory (
  account_id uuid NOT NULL REFERENCES accounts(id),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  store text NOT NULL CHECK (store ~ '^(owner_profile|notes|business:[0-9a-f-]{36})$'),
  entries jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, owner_user_id, store)
);

CREATE TABLE assistant_proposals (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  owner_user_id uuid NOT NULL,
  thread_id uuid NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
  run_id uuid,
  business_id uuid NOT NULL REFERENCES workspaces(id),
  route_key text NOT NULL,
  path text NOT NULL,            -- concrete path with params filled, relative to /api/v1
  query jsonb,
  body jsonb,
  summary text NOT NULL CHECK (char_length(summary) <= 300),
  preview jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','executing','done','failed','rejected','expired')),
  error_code text,
  result_preview text,
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_proposals_thread_idx
  ON assistant_proposals(account_id, owner_user_id, thread_id, created_at);

ALTER TABLE assistant_threads
  ADD COLUMN cache_root_id uuid,
  ADD COLUMN compacted_at timestamptz,
  ADD COLUMN compaction_failed_at timestamptz,
  ADD COLUMN compaction_saved_pcts real[] NOT NULL DEFAULT '{}';

-- Active history is ordered by sort_seq: a compaction summary gets (first summarised seq - 0.5)
-- so it sorts before the kept tail while its seq stays max+1. Ordinary messages: sort_seq = seq.
ALTER TABLE assistant_messages ADD COLUMN sort_seq numeric;
UPDATE assistant_messages SET sort_seq = seq;
ALTER TABLE assistant_messages ALTER COLUMN sort_seq SET NOT NULL;
CREATE INDEX assistant_messages_sort_idx ON assistant_messages(thread_id, sort_seq);

-- Writers that predate this column (a rolling deploy) insert without sort_seq: fill it from seq.
CREATE OR REPLACE FUNCTION assistant_messages_default_sort_seq() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sort_seq IS NULL THEN
    NEW.sort_seq := NEW.seq;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assistant_messages_default_sort_seq
  BEFORE INSERT ON assistant_messages
  FOR EACH ROW EXECUTE FUNCTION assistant_messages_default_sort_seq();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assistant_memory','assistant_proposals'] LOOP
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
