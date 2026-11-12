-- 0076_assistant_sql_scope_seal: bind the assistant SQL scope so the query cannot rewrite it.
--
-- Until now the reader policies of 0060 and 0064 trusted `app.account_id` and
-- `app.assistant_business_ids` alone. The runner sets them with set_config on the assistant login,
-- in the same transaction as the model's query, and EXECUTE on set_config belongs to PUBLIC: a
-- query that got past the SQL guard could rewrite both GUCs to another account's ids and read that
-- account (0060's "a forged id list alone reads nothing" holds only for the id list, not for both).
--
-- Now the runner calls `assistant_sql.bind_scope(account, businesses)` once per transaction. It
-- sets both GUCs and `app.assistant_scope_seal`, a keyed hash of the two values, the backend pid
-- and the transaction start, under a key only app_assistant_reader can read. A second call in the
-- same transaction is refused (a transaction-level advisory lock marks the first one; it cannot be
-- released early). Every reader policy also requires `assistant_sql.scope_sealed()`, so GUCs
-- rewritten inside the query, or a seal copied from another transaction, read nothing.
--
-- The functions set no search_path (a SET clause would undo the GUCs at exit): every name is
-- schema-qualified. Runs as the migration login, like 0060.

-- 1. The key: random per database, readable by the reader only.
CREATE TABLE IF NOT EXISTS public.assistant_sql_scope_key (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  key text NOT NULL
);
REVOKE ALL ON public.assistant_sql_scope_key FROM PUBLIC;
GRANT SELECT ON public.assistant_sql_scope_key TO app_assistant_reader;
INSERT INTO public.assistant_sql_scope_key (key)
  VALUES (pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text)
  ON CONFLICT (id) DO NOTHING;

-- 2. Whether the current GUCs carry the seal bind_scope gave them in this transaction.
CREATE OR REPLACE FUNCTION assistant_sql.scope_sealed() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT coalesce(pg_catalog.current_setting('app.assistant_scope_seal', true) =
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(k.key || pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(k.key || '/' ||
        coalesce(pg_catalog.current_setting('app.account_id', true), '') || '/' ||
        coalesce(pg_catalog.current_setting('app.assistant_business_ids', true), '') || '/' ||
        pg_catalog.pg_backend_pid()::text || '/' ||
        pg_catalog.date_part('epoch', pg_catalog.transaction_timestamp())::text, 'UTF8')),
      'hex'), 'UTF8')), 'hex'), false)
  FROM public.assistant_sql_scope_key k
$$;

-- 3. Sets the scope GUCs and their seal, once per transaction.
CREATE OR REPLACE FUNCTION assistant_sql.bind_scope(p_account text, p_businesses text)
  RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
AS $$
DECLARE k text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_locks l
             WHERE l.locktype = 'advisory' AND l.pid = pg_catalog.pg_backend_pid()
               AND l.classid = 1094795585 AND l.objid = 760 AND l.objsubid = 2) THEN
    RAISE EXCEPTION 'assistant_sql: the scope is already bound' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(1094795585, 760);
  -- Both must parse; the GUCs keep the exact text the runner reads back.
  PERFORM p_account::uuid, p_businesses::uuid[];
  SELECT key INTO STRICT k FROM public.assistant_sql_scope_key;
  PERFORM pg_catalog.set_config('app.account_id', p_account, true),
    pg_catalog.set_config('app.assistant_business_ids', p_businesses, true),
    pg_catalog.set_config('app.assistant_scope_seal',
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(k || pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(k || '/' || p_account || '/' || p_businesses ||
          '/' || pg_catalog.pg_backend_pid()::text || '/' ||
          pg_catalog.date_part('epoch', pg_catalog.transaction_timestamp())::text, 'UTF8')),
        'hex'), 'UTF8')), 'hex'), true);
END
$$;

ALTER FUNCTION assistant_sql.scope_sealed() OWNER TO app_assistant_reader;
ALTER FUNCTION assistant_sql.bind_scope(text, text) OWNER TO app_assistant_reader;
REVOKE ALL ON FUNCTION assistant_sql.scope_sealed() FROM PUBLIC;
REVOKE ALL ON FUNCTION assistant_sql.bind_scope(text, text) FROM PUBLIC;
-- A policy calls its functions as the current user (the login), not as the view owner.
GRANT EXECUTE ON FUNCTION assistant_sql.scope_sealed() TO app_assistant_sql;
GRANT EXECUTE ON FUNCTION assistant_sql.bind_scope(text, text) TO app_assistant_sql;

-- 4. The reader policies of 0060 and 0064, now also requiring the seal (still one InitPlan).
DROP POLICY IF EXISTS workspaces_assistant_reader ON workspaces;
CREATE POLICY workspaces_assistant_reader ON workspaces FOR SELECT TO app_assistant_reader
  USING (
    id = ANY (nullif(current_setting('app.assistant_business_ids', true), '')::uuid[])
    AND account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid)
    AND deleted_at IS NULL
    AND (SELECT assistant_sql.scope_sealed())
  );

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'orders', 'order_items', 'product_variants', 'products', 'inventory', 'contacts',
    'crm_sources', 'crm_statuses', 'conversations', 'channel_connections', 'bots',
    'analytics_facts', 'lodging_bookings', 'lodging_properties', 'contact_history'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_assistant_reader', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO app_assistant_reader '
      'USING (workspace_id = ANY ((SELECT coalesce(array_agg(w.id), ''{}''::uuid[]) '
      'FROM public.workspaces w '
      'WHERE w.id = ANY (nullif(current_setting(''app.assistant_business_ids'', true), '''')::uuid[]) '
      'AND w.account_id = nullif(current_setting(''app.account_id'', true), '''')::uuid '
      'AND w.deleted_at IS NULL '
      'AND assistant_sql.scope_sealed())::uuid[]))',
      t || '_assistant_reader', t);
  END LOOP;
END $$;
