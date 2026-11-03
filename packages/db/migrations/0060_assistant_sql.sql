-- 0060_assistant_sql: the owner assistant's read-only SQL lane (T-171, ADR-024 lane a, ADR-004
-- amendment 2026-11-02). The model writes one SELECT over the curated views of schema
-- `assistant_sql`; Postgres is the sandbox.
--
--   app_assistant_reader  NOLOGIN, nobody is a member. Owns the views. Column-level SELECT on the
--                         15 base tables below (never a PII, note, token or settings column) and
--                         a FOR SELECT policy on each.
--   app_assistant_sql     NOLOGIN group. USAGE on schema assistant_sql and SELECT on its views.
--                         The assistant login (DATABASE_ASSISTANT_SQL_URL, `ensureLoginRoles`) is a
--                         member of this role only, read-only by default, search_path assistant_sql.
--
-- Visibility: every reader policy keeps the rows of the businesses in `app.assistant_business_ids`
-- that also belong to the account in `app.account_id`. The runner (`runAssistantSql`) sets both
-- with set_config(…, true) from the owner scope.
--
-- The views are a published read contract: a migration that changes a column a view reads must
-- recreate the view in the same migration (Postgres refuses to drop the column otherwise).
--
-- Runs as the migration login (`rapiz_owner`, a superuser in infra/deploy/compose.yml and in the
-- test container). A NON-superuser migrator needs `GRANT app_assistant_reader TO <migrator>`
-- before this file runs, to hand the views to app_assistant_reader (step 7).

-- 1. Roles.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_assistant_reader') THEN
    CREATE ROLE app_assistant_reader NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_assistant_sql') THEN
    CREATE ROLE app_assistant_sql NOLOGIN;
  END IF;
END $$;

-- 2. Schema.
CREATE SCHEMA IF NOT EXISTS assistant_sql;
REVOKE ALL ON SCHEMA assistant_sql FROM PUBLIC;

-- 3. Column-level grants to the view owner: exactly the columns the views read. Never granted:
--    contacts.phone, phone_normalized, email, email_normalized, birthday, gender, address, ward,
--    profile_note; orders.recipient, note_internal, note_print, created_by_name, tracking_code;
--    conversations.customer_id, customer_phone, data; channel_connections.token_sealed,
--    external_id, settings; bots.settings; lodging_bookings.guest_phone, note, quote.
--    orders.customer is the one JSON column granted: the view projects only its `name` key.
GRANT USAGE ON SCHEMA public TO app_assistant_reader;
GRANT SELECT (id, account_id, name, industry, timezone, created_at, deleted_at)
  ON workspaces TO app_assistant_reader;
GRANT SELECT (id, workspace_id, code, status, source, created_by_kind, item_qty, subtotal,
              discount_amount, shipping_fee, shipping_fee_charged, total, paid, remaining,
              cod_amount, cost_total, customer, carrier, conversation_id, placed_at, confirmed_at,
              cancelled_at, deleted_at)
  ON orders TO app_assistant_reader;
GRANT SELECT (id, workspace_id, order_id, variant_id, product_name, variant_name, sku, qty,
              unit_price, unit_cost, line_total)
  ON order_items TO app_assistant_reader;
GRANT SELECT (id, workspace_id, product_id, sku, name, price, cost, archived_at)
  ON product_variants TO app_assistant_reader;
GRANT SELECT (id, workspace_id, code, name, category, status, visible_to_bot, created_at)
  ON products TO app_assistant_reader;
GRANT SELECT (workspace_id, variant_id, on_hand, reserved)
  ON inventory TO app_assistant_reader;
GRANT SELECT (id, workspace_id, name, province, source_id, first_source_id, status_id,
              phone_provided_at, archived_at, created_at)
  ON contacts TO app_assistant_reader;
GRANT SELECT (id, workspace_id, name) ON crm_sources TO app_assistant_reader;
GRANT SELECT (id, workspace_id, name) ON crm_statuses TO app_assistant_reader;
GRANT SELECT (id, workspace_id, channel_id, bot_id, contact_id, status, mode, created_at,
              updated_at)
  ON conversations TO app_assistant_reader;
GRANT SELECT (id, workspace_id, provider, name, status, bot_id, created_at)
  ON channel_connections TO app_assistant_reader;
GRANT SELECT (id, workspace_id, name, industry, is_active, order_taking, created_at, deleted_at)
  ON bots TO app_assistant_reader;
GRANT SELECT (workspace_id, kind, occurred_at, origin, contact_id, conversation_id, channel_id,
              bot_id)
  ON analytics_facts TO app_assistant_reader;
GRANT SELECT (id, workspace_id, property_id, code, kind, status, source, check_in, check_out,
              adults, child_ages, guest_name, total_sell, adjustment, total_cost, created_at)
  ON lodging_bookings TO app_assistant_reader;
GRANT SELECT (id, workspace_id, name) ON lodging_properties TO app_assistant_reader;

-- 4. (No helper function.) The design had `assistant_sql_business_ids()`, SECURITY INVOKER, called
--    from the policies. Postgres runs a function in a policy as the CURRENT user (the login), not
--    as the view owner, so the login would have needed EXECUTE on it and SELECT on workspaces.
--    The policies below inline the same predicate as an uncorrelated sub-select instead: its
--    relation access is checked as the view owner, and it runs once per query as an InitPlan.

-- 5. Reader policies, SELECT only. workspaces checks both GUCs inline. Every other table keeps
--    the rows of the businesses in `app.assistant_business_ids` that also belong to the account
--    in `app.account_id` and are not deleted; a forged id list alone reads nothing. The
--    `::uuid[]` cast is needed: without it `ANY ((SELECT …))` reads as `ANY (subquery)`.
DROP POLICY IF EXISTS workspaces_assistant_reader ON workspaces;
CREATE POLICY workspaces_assistant_reader ON workspaces FOR SELECT TO app_assistant_reader
  USING (
    id = ANY (nullif(current_setting('app.assistant_business_ids', true), '')::uuid[])
    AND account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid)
    AND deleted_at IS NULL
  );

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'orders', 'order_items', 'product_variants', 'products', 'inventory', 'contacts',
    'crm_sources', 'crm_statuses', 'conversations', 'channel_connections', 'bots',
    'analytics_facts', 'lodging_bookings', 'lodging_properties'
  ] LOOP
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

-- 6. Views. security_barrier: the view's own filters run before any predicate the model writes.
--    Money is integer VND; times are timestamptz; every view has business_id.
CREATE OR REPLACE VIEW assistant_sql.businesses WITH (security_barrier = true) AS
  SELECT w.id AS business_id, w.name, w.industry, w.timezone, w.created_at
  FROM public.workspaces w
  WHERE w.deleted_at IS NULL;

-- counts_as_revenue mirrors CLOSED_ORDER_STATUSES (packages/contracts commerce.schema.ts);
-- profit is the dashboard's formula.
CREATE OR REPLACE VIEW assistant_sql.orders WITH (security_barrier = true) AS
  SELECT
    o.id AS order_id,
    o.workspace_id AS business_id,
    o.code,
    o.status,
    o.status IN ('confirmed', 'packing', 'awaiting_print', 'printed', 'awaiting_handover',
                 'delivering', 'delivered') AS counts_as_revenue,
    o.status = 'cancelled' AS is_cancelled,
    o.source,
    o.created_by_kind,
    o.item_qty,
    o.subtotal,
    o.discount_amount,
    o.shipping_fee,
    o.shipping_fee_charged,
    o.total,
    o.paid,
    o.remaining,
    o.cod_amount,
    o.cost_total,
    o.subtotal - o.cost_total - o.discount_amount - (o.shipping_fee - o.shipping_fee_charged)
      AS profit,
    o.customer ->> 'name' AS customer_name,
    o.carrier,
    o.conversation_id,
    o.placed_at,
    o.confirmed_at,
    o.cancelled_at
  FROM public.orders o
  WHERE o.deleted_at IS NULL;

-- counts_as_revenue mirrors CLOSED_ORDER_STATUSES, as in assistant_sql.orders.
CREATE OR REPLACE VIEW assistant_sql.order_items WITH (security_barrier = true) AS
  SELECT
    i.id AS order_item_id,
    i.workspace_id AS business_id,
    i.order_id,
    v.product_id,
    i.variant_id,
    i.product_name,
    i.variant_name,
    i.sku,
    i.qty,
    i.unit_price,
    i.unit_cost,
    i.line_total,
    o.status AS order_status,
    o.status IN ('confirmed', 'packing', 'awaiting_print', 'printed', 'awaiting_handover',
                 'delivering', 'delivered') AS counts_as_revenue,
    o.placed_at
  FROM public.order_items i
  JOIN public.orders o ON o.workspace_id = i.workspace_id AND o.id = i.order_id
  LEFT JOIN public.product_variants v ON v.workspace_id = i.workspace_id AND v.id = i.variant_id
  WHERE o.deleted_at IS NULL;

CREATE OR REPLACE VIEW assistant_sql.products WITH (security_barrier = true) AS
  SELECT
    p.id AS product_id,
    p.workspace_id AS business_id,
    p.code,
    p.name,
    p.category,
    p.status,
    p.visible_to_bot,
    p.created_at
  FROM public.products p;

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
    coalesce((SELECT sum(i.on_hand) FROM public.inventory i
              WHERE i.workspace_id = v.workspace_id AND i.variant_id = v.id), 0) AS stock_on_hand,
    coalesce((SELECT sum(i.reserved) FROM public.inventory i
              WHERE i.workspace_id = v.workspace_id AND i.variant_id = v.id), 0) AS stock_reserved
  FROM public.product_variants v;

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
    c.created_at
  FROM public.contacts c
  LEFT JOIN public.crm_sources s ON s.workspace_id = c.workspace_id AND s.id = c.source_id
  LEFT JOIN public.crm_sources fs ON fs.workspace_id = c.workspace_id AND fs.id = c.first_source_id
  LEFT JOIN public.crm_statuses st ON st.workspace_id = c.workspace_id AND st.id = c.status_id;

CREATE OR REPLACE VIEW assistant_sql.conversations WITH (security_barrier = true) AS
  SELECT
    cv.id AS conversation_id,
    cv.workspace_id AS business_id,
    cv.channel_id,
    ch.provider AS channel_provider,
    cv.bot_id,
    cv.contact_id AS customer_id,
    cv.status,
    cv.mode,
    cv.created_at,
    cv.updated_at AS last_activity_at
  FROM public.conversations cv
  LEFT JOIN public.channel_connections ch
    ON ch.workspace_id = cv.workspace_id AND ch.id = cv.channel_id;

CREATE OR REPLACE VIEW assistant_sql.channels WITH (security_barrier = true) AS
  SELECT
    ch.id AS channel_id,
    ch.workspace_id AS business_id,
    ch.provider,
    ch.name,
    ch.status,
    ch.bot_id,
    ch.created_at
  FROM public.channel_connections ch
  WHERE ch.status <> 'removed';

CREATE OR REPLACE VIEW assistant_sql.bots WITH (security_barrier = true) AS
  SELECT
    b.id AS bot_id,
    b.workspace_id AS business_id,
    b.name,
    b.industry,
    b.is_active,
    b.order_taking,
    b.created_at
  FROM public.bots b
  WHERE b.deleted_at IS NULL;

CREATE OR REPLACE VIEW assistant_sql.activity_events WITH (security_barrier = true) AS
  SELECT
    f.workspace_id AS business_id,
    f.kind,
    f.occurred_at,
    f.origin,
    f.contact_id AS customer_id,
    f.conversation_id,
    f.channel_id,
    f.bot_id
  FROM public.analytics_facts f
  WHERE f.kind IN ('customer.created', 'phone.captured', 'conversation.opened',
                   'message.inbound', 'message.outbound');

-- Lodging revenue (Ruling 2-R9): stays only, status confirmed / checked_in / checked_out.
CREATE OR REPLACE VIEW assistant_sql.lodging_bookings WITH (security_barrier = true) AS
  SELECT
    b.id AS booking_id,
    b.workspace_id AS business_id,
    b.property_id,
    p.name AS property_name,
    b.code,
    b.status,
    b.source,
    b.check_in,
    b.check_out,
    b.check_out - b.check_in AS nights,
    b.adults,
    cardinality(b.child_ages) AS children,
    b.guest_name,
    b.total_sell,
    b.adjustment,
    b.total_cost,
    b.status IN ('confirmed', 'checked_in', 'checked_out') AS counts_as_revenue,
    b.created_at
  FROM public.lodging_bookings b
  LEFT JOIN public.lodging_properties p
    ON p.workspace_id = b.workspace_id AND p.id = b.property_id
  WHERE b.kind = 'stay';

-- 7. View ownership: reads behind a view are checked as its owner (security_invoker = false).
GRANT CREATE ON SCHEMA assistant_sql TO app_assistant_reader;
ALTER VIEW assistant_sql.businesses OWNER TO app_assistant_reader;
ALTER VIEW assistant_sql.orders OWNER TO app_assistant_reader;
ALTER VIEW assistant_sql.order_items OWNER TO app_assistant_reader;
ALTER VIEW assistant_sql.products OWNER TO app_assistant_reader;
ALTER VIEW assistant_sql.product_variants OWNER TO app_assistant_reader;
ALTER VIEW assistant_sql.customers OWNER TO app_assistant_reader;
ALTER VIEW assistant_sql.conversations OWNER TO app_assistant_reader;
ALTER VIEW assistant_sql.channels OWNER TO app_assistant_reader;
ALTER VIEW assistant_sql.bots OWNER TO app_assistant_reader;
ALTER VIEW assistant_sql.activity_events OWNER TO app_assistant_reader;
ALTER VIEW assistant_sql.lodging_bookings OWNER TO app_assistant_reader;
REVOKE CREATE ON SCHEMA assistant_sql FROM app_assistant_reader;

-- 8. The login's group: the views and nothing else.
GRANT USAGE ON SCHEMA assistant_sql TO app_assistant_sql;
GRANT SELECT ON ALL TABLES IN SCHEMA assistant_sql TO app_assistant_sql;
