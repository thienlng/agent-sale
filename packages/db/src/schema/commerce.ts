import {
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  unique,
} from 'drizzle-orm/pg-core';

import { bots } from './bot.js';
import { tenantPolicies, workspaces } from './workspace.js';

/** Money columns: bigint VND, read as JS numbers (safe far beyond any order total). */
const money = (name: string) => bigint(name, { mode: 'number' });
const ts = (name: string) => timestamp(name, { withTimezone: true });
const workspaceRef = () =>
  uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id);

/** Tenant tables of migration 0004 (docs/05 §6). */
export const warehouses = pgTable(
  'warehouses',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    name: text('name').notNull(),
    phone: text('phone'),
    province: text('province'),
    ward: text('ward'),
    addressDetail: text('address_detail'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    deletedAt: ts('deleted_at'),
  },
  () => [...tenantPolicies('warehouses')],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    category: text('category'),
    status: text('status').notNull().default('active'),
    visibleToBot: boolean('visible_to_bot').notNull().default(true),
    botInstructions: text('bot_instructions').notNull().default(''),
    imageUrls: jsonb('image_urls').$type<string[]>().notNull().default([]),
    accommodation: jsonb('accommodation').$type<Record<string, unknown> | null>(),
    searchText: text('search_text').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // Target of the same-workspace keys from bot_products (0029) and stay_requests (0035).
    uniqueIndex('products_workspace_id_unique').on(t.workspaceId, t.id),
    ...tenantPolicies('products'),
  ],
);

/** Date occupancy is independent from goods inventory and retail orders. */
export const stayRequests = pgTable(
  'stay_requests',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    propertyId: uuid('property_id').notNull(),
    propertyName: text('property_name').notNull(),
    clientRequestId: uuid('client_request_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    guestName: text('guest_name').notNull(),
    guestPhone: text('guest_phone').notNull(),
    checkIn: date('check_in').notNull(),
    checkOut: date('check_out').notNull(),
    party: jsonb('party').$type<Record<string, unknown>>().notNull(),
    quote: jsonb('quote').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('requested'),
    agreedTotal: money('agreed_total'),
    note: text('note').notNull().default(''),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('stay_requests_request_unique').on(t.workspaceId, t.clientRequestId),
    foreignKey({
      columns: [t.workspaceId, t.propertyId],
      foreignColumns: [products.workspaceId, products.id],
      name: 'stay_requests_property_tenant_fk',
    }),
    index('stay_requests_property_dates_idx').on(
      t.workspaceId,
      t.propertyId,
      t.checkIn,
      t.checkOut,
    ),
    ...tenantPolicies('stay_requests'),
  ],
);

/** Products selected for a bot whose catalog_mode is 'selected' (0029, ADR-012 §5). */
export const botProducts = pgTable(
  'bot_products',
  {
    workspaceId: workspaceRef(),
    botId: uuid('bot_id').notNull(),
    productId: uuid('product_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.botId, t.productId] }),
    foreignKey({
      name: 'bot_products_bot_fk',
      columns: [t.workspaceId, t.botId],
      foreignColumns: [bots.workspaceId, bots.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'bot_products_product_fk',
      columns: [t.workspaceId, t.productId],
      foreignColumns: [products.workspaceId, products.id],
    }).onDelete('cascade'),
    index('bot_products_product_idx').on(t.workspaceId, t.productId),
    ...tenantPolicies('bot_products'),
  ],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull(),
    name: text('name').notNull().default(''),
    price: money('price').notNull(),
    cost: money('cost').notNull().default(0),
    weightGram: integer('weight_gram').notNull().default(0),
    position: integer('position').notNull().default(0),
    archivedAt: ts('archived_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('product_variants_product_idx').on(t.productId),
    ...tenantPolicies('product_variants'),
  ],
);

export const inventory = pgTable(
  'inventory',
  {
    workspaceId: workspaceRef(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    onHand: integer('on_hand').notNull().default(0),
    reserved: integer('reserved').notNull().default(0),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.variantId, t.warehouseId] }), ...tenantPolicies('inventory')],
);

export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    onHandDelta: integer('on_hand_delta').notNull(),
    reservedDelta: integer('reserved_delta').notNull(),
    reason: text('reason').notNull(),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    actorUserId: uuid('actor_user_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  () => [...tenantPolicies('inventory_movements')],
);

export const orderCounters = pgTable(
  'order_counters',
  {
    workspaceId: uuid('workspace_id')
      .primaryKey()
      .references(() => workspaces.id),
    lastValue: bigint('last_value', { mode: 'number' }).notNull().default(0),
  },
  () => [...tenantPolicies('order_counters')],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    code: text('code').notNull(),
    status: text('status').notNull(),
    stockState: text('stock_state').notNull(),
    source: text('source').notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    customer: jsonb('customer').notNull().$type<Record<string, unknown>>(),
    recipient: jsonb('recipient').notNull().$type<Record<string, unknown>>(),
    expectedDeliveryAt: ts('expected_delivery_at'),
    itemQty: integer('item_qty').notNull(),
    subtotal: money('subtotal').notNull(),
    discountType: text('discount_type').notNull(),
    discountValue: money('discount_value').notNull(),
    discountAmount: money('discount_amount').notNull(),
    shippingFee: money('shipping_fee').notNull(),
    shippingFeeCharged: money('shipping_fee_charged').notNull(),
    freeShipping: boolean('free_shipping').notNull().default(false),
    surcharge: money('surcharge').notNull(),
    transferAmount: money('transfer_amount').notNull(),
    total: money('total').notNull(),
    paid: money('paid').notNull(),
    remaining: money('remaining').notNull(),
    codAmount: money('cod_amount').notNull(),
    costTotal: money('cost_total').notNull(),
    carrier: text('carrier'),
    trackingCode: text('tracking_code'),
    noteInternal: text('note_internal').notNull().default(''),
    notePrint: text('note_print').notNull().default(''),
    createdByUserId: uuid('created_by_user_id'),
    createdByName: text('created_by_name'),
    /** A uuid from staff forms; `bot:<conversationId>:<amounts_hash>:<draft createdAt ms>` for bot orders (0039). */
    clientRequestId: text('client_request_id'),
    createdByKind: text('created_by_kind').notNull().default('agent'),
    /** Bot orders (0039): the source conversation and the staff review. */
    conversationId: uuid('conversation_id'),
    reviewState: text('review_state').$type<'pending' | 'approved'>(),
    reviewedByUserId: uuid('reviewed_by_user_id'),
    reviewedByName: text('reviewed_by_name'),
    reviewedAt: ts('reviewed_at'),
    placedAt: ts('placed_at').notNull(),
    confirmedAt: ts('confirmed_at'),
    cancelledAt: ts('cancelled_at'),
    searchText: text('search_text').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    deletedAt: ts('deleted_at'),
  },
  () => [...tenantPolicies('orders')],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id),
    productName: text('product_name').notNull(),
    variantName: text('variant_name').notNull(),
    sku: text('sku').notNull(),
    qty: integer('qty').notNull(),
    unitPrice: money('unit_price').notNull(),
    unitCost: money('unit_cost').notNull(),
    lineTotal: money('line_total').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('order_items_order_idx').on(t.orderId), ...tenantPolicies('order_items')],
);

export const orderStatusHistory = pgTable(
  'order_status_history',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    note: text('note'),
    actorUserId: uuid('actor_user_id'),
    actorName: text('actor_name'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  () => [...tenantPolicies('order_status_history')],
);

export const orderSettings = pgTable(
  'order_settings',
  {
    workspaceId: uuid('workspace_id')
      .primaryKey()
      .references(() => workspaces.id),
    extraStatuses: text('extra_statuses').array().notNull().default([]),
    requireNoteStatuses: text('require_note_statuses').array().notNull().default([]),
    /** Per-source field policies (0005); missing sources use the contract defaults. */
    policies: jsonb('policies')
      .notNull()
      .default([])
      .$type<Array<{ source: string; create: string[]; confirm: string[] }>>(),
    version: integer('version').notNull().default(0),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  () => [...tenantPolicies('order_settings')],
);

/** Tenant table (migration 0039). The order the bot summarised, awaiting the customer's "đặt". */
export const botOrderDrafts = pgTable(
  'bot_order_drafts',
  {
    workspaceId: workspaceRef(),
    conversationId: uuid('conversation_id').notNull(),
    botId: uuid('bot_id').notNull(),
    /** Conversation channel; becomes the order source. */
    channel: text('channel').notNull(),
    lines: jsonb('lines').notNull().$type<Array<{ variantId: string; sku: string; qty: number }>>(),
    recipient: jsonb('recipient')
      .notNull()
      .$type<{ name: string; phone: string; address: string }>(),
    note: text('note'),
    /** Null: "Phí ship: shop báo sau". */
    shippingVnd: money('shipping_vnd'),
    amountsHash: text('amounts_hash').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.conversationId] }),
    foreignKey({
      name: 'bot_order_drafts_bot_fk',
      columns: [t.workspaceId, t.botId],
      foreignColumns: [bots.workspaceId, bots.id],
    }).onDelete('cascade'),
    index('bot_order_drafts_expiry_idx').on(t.workspaceId, t.expiresAt),
    ...tenantPolicies('bot_order_drafts'),
  ],
);
