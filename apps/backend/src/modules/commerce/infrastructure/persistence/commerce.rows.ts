import { CLOSED_ORDER_STATUSES } from '@agent-sales/contracts';
import { schema, sql } from '@agent-sales/db';

import type {
  OrderRecord,
  ProductRecord,
  VariantRecord,
  WarehouseRecord,
} from '../../application/ports/commerce-store.js';
import type { OrderStatus, StockState } from '../../domain/order-stock.js';

/** Row ↔ record mapping and SQL fragments shared by the commerce Drizzle adapters. */
export const w = schema.warehouses;
export const p = schema.products;
export const bp = schema.botProducts;
export const v = schema.productVariants;
export const inv = schema.inventory;
export const o = schema.orders;
export const oi = schema.orderItems;
export const h = schema.orderStatusHistory;

export const pgCode = (e: unknown): string | undefined =>
  (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code;
/** `column LIKE %q%` with the user's text taken literally (\\, % and _ escaped). */
export function contains(column: unknown, q: string) {
  const literal = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  return sql`${column} like ${`%${literal}%`} escape '\\'`;
}

export const n = (x: unknown): number => Number(x ?? 0);
const closedList = sql.join(
  CLOSED_ORDER_STATUSES.map((s) => sql`${s}`),
  sql`, `,
);
export const isClosed = sql`${o.status} in (${closedList})`;
export const profitExpr = sql`${o.subtotal} - ${o.costTotal} - ${o.discountAmount} - (${o.shippingFee} - ${o.shippingFeeCharged})`;

export function toWarehouse(r: typeof w.$inferSelect): WarehouseRecord {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    province: r.province,
    ward: r.ward,
    addressDetail: r.addressDetail,
    isDefault: r.isDefault,
  };
}

export function toProduct(r: typeof p.$inferSelect): ProductRecord {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    category: r.category,
    status: r.status as ProductRecord['status'],
    visibleToBot: r.visibleToBot,
    botInstructions: r.botInstructions,
    imageUrls: r.imageUrls,
    searchText: r.searchText,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toVariant(r: typeof v.$inferSelect): VariantRecord {
  return {
    id: r.id,
    productId: r.productId,
    sku: r.sku,
    name: r.name,
    price: r.price,
    cost: r.cost,
    weightGram: r.weightGram,
    position: r.position,
    archived: r.archivedAt !== null,
  };
}

export function toOrder(r: typeof o.$inferSelect): OrderRecord {
  return {
    id: r.id,
    code: r.code,
    status: r.status as OrderStatus,
    stockState: r.stockState as StockState,
    source: r.source,
    warehouseId: r.warehouseId,
    customer: r.customer,
    recipient: r.recipient,
    expectedDeliveryAt: r.expectedDeliveryAt,
    itemQty: r.itemQty,
    subtotal: r.subtotal,
    discountType: r.discountType as OrderRecord['discountType'],
    discountValue: r.discountValue,
    discountAmount: r.discountAmount,
    shippingFee: r.shippingFee,
    shippingFeeCharged: r.shippingFeeCharged,
    freeShipping: r.freeShipping,
    surcharge: r.surcharge,
    transferAmount: r.transferAmount,
    total: r.total,
    paid: r.paid,
    remaining: r.remaining,
    codAmount: r.codAmount,
    costTotal: r.costTotal,
    carrier: r.carrier,
    trackingCode: r.trackingCode,
    noteInternal: r.noteInternal,
    notePrint: r.notePrint,
    createdByUserId: r.createdByUserId,
    createdByName: r.createdByName,
    clientRequestId: r.clientRequestId,
    placedAt: r.placedAt,
    confirmedAt: r.confirmedAt,
    cancelledAt: r.cancelledAt,
    searchText: r.searchText,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function orderRow(ws: string, r: OrderRecord) {
  const { id: _id, ...rest } = r;
  return { id: r.id, workspaceId: ws, ...rest };
}
