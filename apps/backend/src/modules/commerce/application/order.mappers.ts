import type { OrderDto, OrderSummaryDto } from '@agent-sales/contracts';
import { type Amounts, foldVietnamese } from '@agent-sales/shared';

import type { StockAction } from '../domain/order-stock.js';
import type {
  HistoryRecord,
  OrderItemPreview,
  OrderItemRecord,
  OrderRecord,
  StockChange,
} from './ports/commerce-store.js';

export function orderSearchText(
  o: Pick<
    OrderRecord,
    'code' | 'trackingCode' | 'customer' | 'recipient' | 'noteInternal' | 'notePrint'
  >,
): string {
  const c = o.customer as { name?: string; phone?: string };
  const r = o.recipient as {
    name?: string;
    phone?: string;
    address?: string;
    province?: string;
    ward?: string;
  };
  return foldVietnamese(
    [
      o.code,
      o.trackingCode,
      c.name,
      c.phone,
      r.name,
      r.phone,
      r.address,
      r.ward,
      r.province,
      o.noteInternal,
      o.notePrint,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

/** Inventory changes that carry out the stock actions for every line of an order. */
export function stockChanges(
  actions: StockAction[],
  order: Pick<OrderRecord, 'id' | 'warehouseId'>,
  items: Array<Pick<OrderItemRecord, 'variantId' | 'qty'>>,
  actorUserId: string | null,
): StockChange[] {
  const delta: Record<StockAction, { onHand: number; reserved: number }> = {
    reserve: { onHand: 0, reserved: 1 },
    release: { onHand: 0, reserved: -1 },
    ship: { onHand: -1, reserved: -1 },
    return: { onHand: 1, reserved: 0 },
  };
  return actions.flatMap((action) =>
    items.map((i) => ({
      variantId: i.variantId,
      warehouseId: order.warehouseId,
      onHandDelta: delta[action].onHand * i.qty,
      reservedDelta: delta[action].reserved * i.qty,
      reason: action,
      refType: 'order' as const,
      refId: order.id,
      actorUserId,
    })),
  );
}

/**
 * Reservation moves for edited lines of an order that holds its goods: per variant,
 * reserve what was added and release what was removed (net of both).
 */
export function reservationChanges(
  order: Pick<OrderRecord, 'id' | 'warehouseId'>,
  before: Array<Pick<OrderItemRecord, 'variantId' | 'qty'>>,
  after: Array<Pick<OrderItemRecord, 'variantId' | 'qty'>>,
  actorUserId: string | null,
): StockChange[] {
  const delta = new Map<string, number>();
  for (const i of before) delta.set(i.variantId, (delta.get(i.variantId) ?? 0) - i.qty);
  for (const i of after) delta.set(i.variantId, (delta.get(i.variantId) ?? 0) + i.qty);
  return [...delta]
    .filter(([, d]) => d !== 0)
    .map(([variantId, d]) => ({
      variantId,
      warehouseId: order.warehouseId,
      onHandDelta: 0,
      reservedDelta: d,
      reason: d > 0 ? ('reserve' as const) : ('release' as const),
      refType: 'order' as const,
      refId: order.id,
      actorUserId,
    }));
}

/** The stored amount columns of an order, from the shared formulas. */
/** Origin of an order staff create: no conversation, nothing to review. */
export const STAFF_ORDER_ORIGIN = {
  createdByKind: 'agent',
  conversationId: null,
  reviewState: null,
  reviewedByUserId: null,
  reviewedByName: null,
  reviewedAt: null,
} as const satisfies Partial<OrderRecord>;

export function amountFields(a: Amounts) {
  return {
    itemQty: a.itemQty,
    subtotal: a.subtotal,
    discountType: a.discountType,
    discountValue: a.discountValue,
    discountAmount: a.discountAmount,
    shippingFee: a.shippingFee,
    shippingFeeCharged: a.shippingFeeCharged,
    freeShipping: a.freeShipping,
    surcharge: a.surcharge,
    transferAmount: a.transferAmount,
    total: a.total,
    paid: a.paid,
    remaining: a.remaining,
    codAmount: a.cod,
    costTotal: a.costTotal,
  } satisfies Partial<OrderRecord>;
}

function amountsOf(o: OrderRecord) {
  return {
    itemQty: o.itemQty,
    subtotal: o.subtotal,
    discountType: o.discountType,
    discountValue: o.discountValue,
    discountAmount: o.discountAmount,
    afterDiscount: o.subtotal - o.discountAmount,
    shippingFee: o.shippingFee,
    shippingFeeCharged: o.shippingFeeCharged,
    freeShipping: o.freeShipping,
    surcharge: o.surcharge,
    gross: o.subtotal + o.shippingFeeCharged + o.surcharge,
    total: o.total,
    transferAmount: o.transferAmount,
    paid: o.paid,
    remaining: o.remaining,
    cod: o.codAmount,
  };
}

/** Lines a summary carries; the order may have more (`itemCount`). */
export const PREVIEW_LINES = 10;

export function toSummary(
  o: OrderRecord,
  itemsPreview: OrderItemPreview[],
  itemCount: number,
): OrderSummaryDto {
  return {
    id: o.id,
    code: o.code,
    status: o.status,
    source: o.source as OrderSummaryDto['source'],
    customer: o.customer as OrderSummaryDto['customer'],
    recipient: o.recipient as OrderSummaryDto['recipient'],
    carrier: o.carrier,
    trackingCode: o.trackingCode,
    noteInternal: o.noteInternal,
    amounts: amountsOf(o),
    itemsPreview: itemsPreview.slice(0, PREVIEW_LINES),
    itemCount,
    createdByName: o.createdByName,
    createdByKind: o.createdByKind,
    reviewState: o.reviewState,
    reviewedByName: o.reviewedByName,
    reviewedAt: o.reviewedAt?.toISOString() ?? null,
    conversationId: o.conversationId,
    placedAt: o.placedAt.toISOString(),
  };
}

export function toOrderDto(
  o: OrderRecord,
  items: OrderItemRecord[],
  history: HistoryRecord[],
  warehouseName: string,
  images: ReadonlyMap<string, string> = new Map(),
): OrderDto {
  return {
    ...toSummary(
      o,
      items.slice(0, PREVIEW_LINES).map((i) => ({
        name: [i.productName, i.variantName].filter(Boolean).join(' – '),
        qty: i.qty,
        variantName: i.variantName || null,
        unitPrice: i.unitPrice,
        imageUrl: images.get(i.variantId) ?? null,
      })),
      items.length,
    ),
    warehouseId: o.warehouseId,
    warehouseName,
    expectedDeliveryAt: o.expectedDeliveryAt?.toISOString() ?? null,
    notePrint: o.notePrint,
    items: items.map((i) => ({
      id: i.id,
      variantId: i.variantId,
      productName: i.productName,
      variantName: i.variantName,
      sku: i.sku,
      qty: i.qty,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
    })),
    history: history.map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      note: h.note,
      actorName: h.actorName,
      at: h.createdAt.toISOString(),
    })),
    stockState: o.stockState,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}
