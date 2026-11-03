/**
 * The model's map of the read-only SQL lane (T-171, spec §4.3 and §6): the `assistant_sql` views,
 * their columns in the database's order, what each one means, and example queries. The
 * `sql_schema` tool renders it. An integration test checks the names and types against
 * `information_schema.columns`; a unit test runs every example through the SQL guard.
 */

export interface SqlViewColumn {
  name: string;
  /** Short Postgres type: uuid, text, integer, bigint, numeric, boolean, date, timestamptz. */
  type: string;
  description: string;
}

export interface SqlView {
  name: string;
  description: string;
  columns: SqlViewColumn[];
  examples: string[];
}

type Col = [name: string, type: string, description: string];

const view = (name: string, description: string, cols: Col[], examples: string[]): SqlView => ({
  name,
  description,
  columns: cols.map(([n, type, d]) => ({ name: n, type, description: d })),
  examples,
});

const ID = (what: string): Col => ['business_id', 'uuid', `the business this ${what} belongs to`];

export const SQL_VIEWS: readonly SqlView[] = [
  view(
    'businesses',
    'the owner’s businesses (shops) in scope',
    [
      ['business_id', 'uuid', 'the business id'],
      ['name', 'text', 'business name'],
      ['industry', 'text', 'industry key (retail, fashion, hotel, saas, …)'],
      ['timezone', 'text', 'IANA time zone of the business'],
      ['created_at', 'timestamptz', 'when the business was created'],
    ],
    ['select business_id, name, industry from businesses order by name'],
  ),
  view(
    'orders',
    'sales orders, one row per order (deleted orders left out)',
    [
      ['order_id', 'uuid', 'order id'],
      ID('order'),
      ['code', 'text', 'order code shown to the owner'],
      [
        'status',
        'text',
        'order status (draft, confirmed, packing, delivering, delivered, cancelled, …)',
      ],
      ['counts_as_revenue', 'boolean', 'true for closed orders: these make revenue and profit'],
      ['is_cancelled', 'boolean', 'true when the order was cancelled'],
      ['source', 'text', 'where the order came from (manual, bot, …)'],
      ['created_by_kind', 'text', 'who created it: agent (staff) or bot'],
      ['item_qty', 'integer', 'number of items in the order'],
      ['subtotal', 'bigint', 'items total before discount, VND'],
      ['discount_amount', 'bigint', 'discount, VND'],
      ['shipping_fee', 'bigint', 'shipping cost paid to the carrier, VND'],
      ['shipping_fee_charged', 'bigint', 'shipping fee charged to the customer, VND'],
      ['total', 'bigint', 'order total the customer pays, VND'],
      ['paid', 'bigint', 'amount already paid, VND'],
      ['remaining', 'bigint', 'amount still to pay, VND'],
      ['cod_amount', 'bigint', 'cash on delivery to collect, VND'],
      ['cost_total', 'bigint', 'cost of goods, VND'],
      ['profit', 'bigint', 'subtotal − cost − discount − unpaid shipping, VND'],
      ['customer_name', 'text', 'customer name on the order'],
      ['carrier', 'text', 'shipping carrier'],
      ['conversation_id', 'uuid', 'chat the order came from (bot orders)'],
      ['placed_at', 'timestamptz', 'when the order was placed: use for date ranges'],
      ['confirmed_at', 'timestamptz', 'when the order was confirmed'],
      ['cancelled_at', 'timestamptz', 'when the order was cancelled'],
    ],
    [
      "select b.name, sum(o.total) as revenue from orders o join businesses b using (business_id) where o.counts_as_revenue and o.placed_at >= date_trunc('week', now()) group by b.name order by revenue desc",
      "select placed_at::date as day, count(*) as orders, sum(total) filter (where not is_cancelled) as sales from orders where placed_at >= date_trunc('month', now()) group by 1 order by 1",
    ],
  ),
  view(
    'order_items',
    'order lines with the order’s status and date (best sellers)',
    [
      ['order_item_id', 'uuid', 'order line id'],
      ID('line'),
      ['order_id', 'uuid', 'the order'],
      ['product_id', 'uuid', 'the product (null when the variant is gone)'],
      ['variant_id', 'uuid', 'the product variant'],
      ['product_name', 'text', 'product name at the time of the order'],
      ['variant_name', 'text', 'variant name at the time of the order'],
      ['sku', 'text', 'variant SKU'],
      ['qty', 'integer', 'quantity sold'],
      ['unit_price', 'bigint', 'price per unit, VND'],
      ['unit_cost', 'bigint', 'cost per unit, VND'],
      ['line_total', 'bigint', 'line total, VND'],
      ['order_status', 'text', 'status of the order'],
      ['counts_as_revenue', 'boolean', 'the order is closed: count it in best sellers'],
      ['placed_at', 'timestamptz', 'when the order was placed'],
    ],
    [
      "select product_name, sum(qty) as qty from order_items where counts_as_revenue and placed_at >= date_trunc('month', now()) - interval '1 month' and placed_at < date_trunc('month', now()) group by product_name order by qty desc limit 5",
    ],
  ),
  view(
    'products',
    'products of the catalog',
    [
      ['product_id', 'uuid', 'product id'],
      ID('product'),
      ['code', 'text', 'product code'],
      ['name', 'text', 'product name'],
      ['category', 'text', 'category'],
      ['status', 'text', 'active or hidden'],
      ['visible_to_bot', 'boolean', 'the bot may offer it'],
      ['created_at', 'timestamptz', 'when it was added'],
    ],
    ['select status, count(*) as products from products group by status'],
  ),
  view(
    'product_variants',
    'product variants with price, cost and stock summed over warehouses',
    [
      ['variant_id', 'uuid', 'variant id'],
      ID('variant'),
      ['product_id', 'uuid', 'the product'],
      ['sku', 'text', 'SKU'],
      ['name', 'text', 'variant name (size, color, …)'],
      ['price', 'bigint', 'selling price, VND'],
      ['cost', 'bigint', 'cost price, VND'],
      ['archived', 'boolean', 'the variant is archived'],
      ['stock_on_hand', 'bigint', 'units in stock'],
      ['stock_reserved', 'bigint', 'units reserved by open orders'],
    ],
    [
      'select p.name, v.sku, v.stock_on_hand - v.stock_reserved as available from product_variants v join products p using (product_id) where not v.archived order by available limit 10',
    ],
  ),
  view(
    'customers',
    'CRM customers (no phone, email or address; has_phone says whether a phone was given)',
    [
      ['customer_id', 'uuid', 'customer id'],
      ID('customer'),
      ['name', 'text', 'customer name'],
      ['province', 'text', 'province'],
      ['source_name', 'text', 'current source (Facebook, Zalo, …)'],
      ['first_source_name', 'text', 'the source the customer first came from'],
      ['status_name', 'text', 'CRM status'],
      ['has_phone', 'boolean', 'the customer gave a phone number'],
      ['archived', 'boolean', 'archived customer'],
      ['created_at', 'timestamptz', 'when the customer was created: use for new customers'],
    ],
    [
      "select coalesce(source_name, 'unknown') as source, count(*) as customers from customers where created_at >= date_trunc('month', now()) group by 1 order by 2 desc",
    ],
  ),
  view(
    'conversations',
    'chat conversations with customers, per channel and bot',
    [
      ['conversation_id', 'uuid', 'conversation id'],
      ID('conversation'),
      ['channel_id', 'uuid', 'the channel'],
      ['channel_provider', 'text', 'facebook, instagram, zalo, webchat, …'],
      ['bot_id', 'uuid', 'the bot answering it'],
      ['customer_id', 'uuid', 'the CRM customer'],
      ['status', 'text', 'conversation status'],
      ['mode', 'text', 'bot or human handling'],
      ['created_at', 'timestamptz', 'when the conversation started'],
      ['last_activity_at', 'timestamptz', 'last activity'],
    ],
    [
      "select channel_provider, count(*) as conversations from conversations where created_at >= now() - interval '30 days' group by 1 order by 2 desc",
    ],
  ),
  view(
    'channels',
    'connected channels (pages, accounts, web chat)',
    [
      ['channel_id', 'uuid', 'channel id'],
      ID('channel'),
      ['provider', 'text', 'facebook, instagram, zalo, webchat, …'],
      ['name', 'text', 'channel name'],
      ['status', 'text', 'connection status'],
      ['bot_id', 'uuid', 'the bot assigned to it'],
      ['created_at', 'timestamptz', 'when it was connected'],
    ],
    ['select provider, name, status from channels order by provider, name'],
  ),
  view(
    'bots',
    'the businesses’ sales bots',
    [
      ['bot_id', 'uuid', 'bot id'],
      ID('bot'),
      ['name', 'text', 'bot name'],
      ['industry', 'text', 'industry key'],
      ['is_active', 'boolean', 'the bot is on'],
      ['order_taking', 'boolean', 'the bot takes orders'],
      ['created_at', 'timestamptz', 'when it was created'],
    ],
    ['select name, is_active, order_taking from bots order by name'],
  ),
  view(
    'activity_events',
    'activity facts: customer.created, phone.captured, conversation.opened, message.inbound, message.outbound',
    [
      ID('event'),
      ['kind', 'text', 'event kind (see the view description)'],
      ['occurred_at', 'timestamptz', 'when it happened'],
      ['origin', 'text', 'who caused it: customer, bot, agent, …'],
      ['customer_id', 'uuid', 'the CRM customer'],
      ['conversation_id', 'uuid', 'the conversation'],
      ['channel_id', 'uuid', 'the channel'],
      ['bot_id', 'uuid', 'the bot'],
    ],
    [
      "select d::date as day, count(e.kind) as inbound from generate_series(date_trunc('day', now()) - interval '6 days', date_trunc('day', now()), interval '1 day') d left join activity_events e on e.kind = 'message.inbound' and e.occurred_at >= d and e.occurred_at < d + interval '1 day' group by d order by d",
      "select origin, count(*) as replies from activity_events where kind = 'message.outbound' and occurred_at >= date_trunc('week', now()) group by origin",
    ],
  ),
  view(
    'lodging_bookings',
    'lodging stays only (homestay, villa, hotel bookings); date blocks (chặn ngày) are not in this view: read them with GET /lodging/calendar',
    [
      ['booking_id', 'uuid', 'booking id'],
      ID('booking'),
      ['property_id', 'uuid', 'the property (room or villa)'],
      ['property_name', 'text', 'property name'],
      ['code', 'text', 'booking code'],
      ['status', 'text', 'hold, confirmed, checked_in, checked_out, cancelled, …'],
      ['source', 'text', 'where the booking came from'],
      ['check_in', 'date', 'arrival night'],
      ['check_out', 'date', 'departure day'],
      ['nights', 'integer', 'number of nights'],
      ['adults', 'integer', 'adults'],
      ['children', 'integer', 'children'],
      ['guest_name', 'text', 'guest name'],
      ['total_sell', 'bigint', 'price of the stay, VND'],
      ['adjustment', 'bigint', 'manual adjustment, VND (separate from total_sell)'],
      ['total_cost', 'bigint', 'cost of the stay, VND'],
      ['counts_as_revenue', 'boolean', 'confirmed, checked in or checked out'],
      ['created_at', 'timestamptz', 'when the booking was made'],
    ],
    [
      "select property_name, sum(nights) as nights, sum(total_sell) as revenue from lodging_bookings where counts_as_revenue and check_in >= date_trunc('month', now())::date group by 1 order by 3 desc",
    ],
  ),
];

export const SQL_VIEW_NAMES: ReadonlySet<string> = new Set(SQL_VIEWS.map((v) => v.name));

/** The rules the model follows when it writes a query (spec §6). */
export const SQL_RULES = [
  'Rules:',
  '- Money is integer VND.',
  "- Times are local Asia/Ho_Chi_Minh: use placed_at::date for days; weeks start on Monday with date_trunc('week', …).",
  '- Revenue (doanh thu) = sum(total) where counts_as_revenue. Sales (doanh số) = sum(total) where not is_cancelled. Profit = sum(profit) where counts_as_revenue. Best sellers come from order_items where counts_as_revenue.',
  "- A hotel business (businesses.industry = 'hotel') earns from stays, not orders: its revenue = sum(total_sell) from lodging_bookings where counts_as_revenue, dated by check_in; nights sold = sum(nights); profit = sum(total_sell - total_cost). When the owner asks for revenue without saying which, check the industry: a hotel's from lodging_bookings, a shop's from orders, and both (one line each) for an account with both.",
  '- A total over a breakdown comes from the query (sum(...) over (), ROLLUP or a count), never from adding rows.',
  '- Always filter a date range and aggregate; never list raw rows when a total answers.',
  '- With more than one business, group by business_id and join businesses for the name.',
  '- One SELECT; WITH is fine. No comments, no quoted identifiers, no schema prefixes.',
  '- Message counts come from activity_events. message.outbound covers both bot replies and page replies.',
].join('\n');

const byName = new Map(SQL_VIEWS.map((v) => [v.name, v]));

/** The rules, then one line per view: `name(col, …) — description`. */
export function renderSqlOverview(): string {
  const lines = SQL_VIEWS.map(
    (v) => `${v.name}(${v.columns.map((c) => c.name).join(', ')}) — ${v.description}`,
  );
  return `${SQL_RULES}\n\nViews:\n${lines.join('\n')}`;
}

/** One view: each column with its type and meaning, then example queries; null when unknown. */
export function renderSqlView(name: string): string | null {
  const v = byName.get(name.trim().toLowerCase());
  if (!v) return null;
  const cols = v.columns.map((c) => `- ${c.name} ${c.type}: ${c.description}`);
  const examples = v.examples.map((e) => `- ${e}`);
  return `${v.name} — ${v.description}\n\nColumns:\n${cols.join('\n')}\n\nExamples:\n${examples.join('\n')}`;
}
