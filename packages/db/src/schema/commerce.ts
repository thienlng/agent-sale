import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

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
    searchText: text('search_text').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  () => [...tenantPolicies('products')],
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
    clientRequestId: uuid('client_request_id'),
    createdByKind: text('created_by_kind').notNull().default('agent'),
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
