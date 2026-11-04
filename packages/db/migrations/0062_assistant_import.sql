-- Owner assistant capability 4, bulk product import (T-173, ADR-024): import batches holding the
-- owner's sheet rows or photo drafts, one `product_import` proposal per batch, and the
-- `import_vision` run kind. Additive only.

CREATE TABLE assistant_import_batches (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  owner_user_id uuid NOT NULL,
  thread_id uuid NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES workspaces(id),
  kind text NOT NULL CHECK (kind IN ('sheet','photos')),
  file_name text NOT NULL CHECK (char_length(file_name) <= 200),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('drafting','ready')),
  -- Sheet: {kind, rows}. Photos: {kind, grouping, groups}. Never sent to the web.
  source jsonb NOT NULL CHECK (octet_length(source::text) <= 2000000),
  spec jsonb,
  overrides jsonb NOT NULL DEFAULT '{}',
  excluded jsonb NOT NULL DEFAULT '[]',
  drafts jsonb,
  drafts_hash text,
  results jsonb NOT NULL DEFAULT '{}',
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_import_batches_thread_idx
  ON assistant_import_batches(account_id, owner_user_id, thread_id, created_at);

-- The proposal kind is shared with capability 3 (schedules); either migration may add it first.
ALTER TABLE assistant_proposals ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'route';
ALTER TABLE assistant_proposals DROP CONSTRAINT IF EXISTS assistant_proposals_kind_check;
ALTER TABLE assistant_proposals ADD CONSTRAINT assistant_proposals_kind_check
  CHECK (kind IN ('route','schedule','product_import'));
ALTER TABLE assistant_proposals
  ADD COLUMN import_batch_id uuid REFERENCES assistant_import_batches(id) ON DELETE CASCADE;
ALTER TABLE assistant_proposals ADD CONSTRAINT assistant_proposals_import_batch_check
  CHECK ((kind = 'product_import') = (import_batch_id IS NOT NULL));
CREATE INDEX assistant_proposals_import_batch_idx
  ON assistant_proposals(import_batch_id) WHERE import_batch_id IS NOT NULL;

-- assistant_runs.kind gains 'import_vision'. The list is read from the current constraint, so
-- kinds added by migrations of other capabilities (whatever their order) are kept.
DO $$
DECLARE kinds text;
BEGIN
  SELECT string_agg(quote_literal(k), ',' ORDER BY k) INTO kinds FROM (
    SELECT m[1] AS k
      FROM pg_constraint c,
           regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
     WHERE c.conrelid = 'assistant_runs'::regclass AND c.conname = 'assistant_runs_kind_check'
    UNION
    SELECT 'import_vision'
  ) x;
  EXECUTE format(
    'ALTER TABLE assistant_runs DROP CONSTRAINT IF EXISTS assistant_runs_kind_check, '
    'ADD CONSTRAINT assistant_runs_kind_check CHECK (kind IN (%s))', kinds);
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assistant_import_batches'] LOOP
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
