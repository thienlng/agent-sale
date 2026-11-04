-- 0064_service_verticals: the education and spa verticals (T-187, spec
-- 2026-11-04-verticals-education-spa §7). Additive only.
--
--   1. products.offering: a course or a service sold as a product (never with accommodation).
--   2. A partial index for the bot-recorded customer requests (reports and the request summary).
--   3. assistant_sql: customers.status_key, the customer_requests view, no stock on offerings.
--   4. assistant_schedules: the new_requests report / alert template.
--
-- Runs as the migration login, like 0060 (it hands the new view to app_assistant_reader).

-- 1. Product offerings. Valid at once: every existing row has a null offering.
ALTER TABLE products ADD COLUMN IF NOT EXISTS offering jsonb;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_offering_or_accommodation;
ALTER TABLE products ADD CONSTRAINT products_offering_or_accommodation
  CHECK (offering IS NULL OR accommodation IS NULL);

-- 2. Requests recorded by the bot (`contact.request_recorded`), per business and time. The 24 h
--    update lookup reads one contact's history through contact_history_contact_idx.
CREATE INDEX IF NOT EXISTS contact_history_requests_idx
  ON contact_history (workspace_id, created_at)
  WHERE type = 'contact.request_recorded';

-- 3. assistant_sql. Column grants to the view owner: the status key, the history columns the
--    customer_requests view reads (it projects only allowlisted keys of `data`), and the product
--    offering (the product_variants view reads only whether it is set).
GRANT SELECT (key) ON crm_statuses TO app_assistant_reader;
GRANT SELECT (id, workspace_id, contact_id, type, data, created_at)
  ON contact_history TO app_assistant_reader;
GRANT SELECT (offering) ON products TO app_assistant_reader;

-- The reader policy of 0060, for contact_history.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contact_history'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_assistant_reader', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO app_assistant_reader '
      'USING (workspace_id = ANY ((SELECT coalesce(array_agg(w.id), ''{}''::uuid[]) '
      'FROM public.workspaces w '
      'WHERE w.id = ANY (nullif(current_setting(''app.assistant_business_ids'', true), '''')::uuid[]) '
      'AND w.account_id = nullif(current_setting(''app.account_id'', true), '''')::uuid '
      'AND w.deleted_at IS NULL)::uuid[]))',
      t || '_assistant_reader', t);
  END LOOP;
END $$;

-- The customers view of 0060 with status_key appended (CREATE OR REPLACE may only append).
CREATE OR REPLACE VIEW assistant_sql.customers WITH (security_barrier = true) AS
  SELECT
    c.id AS customer_id,
    c.workspace_id AS business_id,
    c.name,
    c.province,
    s.name AS source_name,
    fs.name AS first_source_name,
    st.name AS status_name,
    c.phone_provided_at IS NOT NULL AS has_phone,
    c.archived_at IS NOT NULL AS archived,
    c.created_at,
    st.key AS status_key
  FROM public.contacts c
  LEFT JOIN public.crm_sources s ON s.workspace_id = c.workspace_id AND s.id = c.source_id
  LEFT JOIN public.crm_sources fs ON fs.workspace_id = c.workspace_id AND fs.id = c.first_source_id
  LEFT JOIN public.crm_statuses st ON st.workspace_id = c.workspace_id AND st.id = c.status_id;

-- A course or a service has no stock: its variants keep their prices but report null stock, so
-- a low-stock question never lists them (spec §5.2).
CREATE OR REPLACE VIEW assistant_sql.product_variants WITH (security_barrier = true) AS
  SELECT
    v.id AS variant_id,
    v.workspace_id AS business_id,
    v.product_id,
    v.sku,
    v.name,
    v.price,
    v.cost,
    v.archived_at IS NOT NULL AS archived,
    CASE WHEN p.offering IS NULL THEN
      coalesce((SELECT sum(i.on_hand) FROM public.inventory i
                WHERE i.workspace_id = v.workspace_id AND i.variant_id = v.id), 0)
    END AS stock_on_hand,
    CASE WHEN p.offering IS NULL THEN
      coalesce((SELECT sum(i.reserved) FROM public.inventory i
                WHERE i.workspace_id = v.workspace_id AND i.variant_id = v.id), 0)
    END AS stock_reserved
  FROM public.product_variants v
  LEFT JOIN public.products p ON p.workspace_id = v.workspace_id AND p.id = v.product_id;

-- Customer requests recorded by the bot: no name, phone, email or free text. `item` is the
-- course (education), service (spa) or plan (saas); `is_update` marks the same kind again within
-- 24 h. A malformed preferredDate reads as null instead of failing the query.
CREATE OR REPLACE VIEW assistant_sql.customer_requests WITH (security_barrier = true) AS
  SELECT
    h.id AS request_id,
    h.workspace_id AS business_id,
    h.contact_id AS customer_id,
    h.data ->> 'kind' AS kind,
    h.type = 'contact.request_updated' AS is_update,
    coalesce(nullif(h.data -> 'details' ->> 'course', ''),
             nullif(h.data -> 'details' ->> 'service', ''),
             nullif(h.data -> 'details' ->> 'planInterest', '')) AS item,
    nullif(h.data -> 'details' ->> 'branch', '') AS branch,
    CASE WHEN (h.data -> 'details' ->> 'preferredDate') ~ '^\d{4}-\d{2}-\d{2}$'
      THEN (h.data -> 'details' ->> 'preferredDate')::date END AS preferred_date,
    h.created_at,
    st.key AS current_status_key,
    st.name AS current_status_name
  FROM public.contact_history h
  LEFT JOIN public.contacts c ON c.workspace_id = h.workspace_id AND c.id = h.contact_id
  LEFT JOIN public.crm_statuses st ON st.workspace_id = c.workspace_id AND st.id = c.status_id
  WHERE h.type IN ('contact.request_recorded', 'contact.request_updated');

GRANT CREATE ON SCHEMA assistant_sql TO app_assistant_reader;
ALTER VIEW assistant_sql.customers OWNER TO app_assistant_reader;
ALTER VIEW assistant_sql.product_variants OWNER TO app_assistant_reader;
ALTER VIEW assistant_sql.customer_requests OWNER TO app_assistant_reader;
REVOKE CREATE ON SCHEMA assistant_sql FROM app_assistant_reader;
GRANT SELECT ON assistant_sql.customer_requests TO app_assistant_sql;

-- 4. The new_requests template: a report (period) or an alert (minCount).
ALTER TABLE assistant_schedules DROP CONSTRAINT IF EXISTS assistant_schedules_template_check;
ALTER TABLE assistant_schedules ADD CONSTRAINT assistant_schedules_template_check
  CHECK (template IN ('revenue_summary','new_orders','low_stock','unanswered_conversations',
                      'new_customers','new_requests'));
ALTER TABLE assistant_schedules DROP CONSTRAINT IF EXISTS assistant_schedules_mode_template_check;
ALTER TABLE assistant_schedules ADD CONSTRAINT assistant_schedules_mode_template_check
  CHECK (mode = 'report' OR template IN ('new_orders','low_stock','unanswered_conversations',
                                         'new_requests'));
