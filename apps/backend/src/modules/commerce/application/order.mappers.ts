import type { OrderDto, OrderSummaryDto } from '@agent-sales/contracts';
import { foldVietnamese } from '@agent-sales/shared';

import type { StockAction } from '../domain/order-stock.js';
import type {
  HistoryRecord,
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
    total: o.total,
    transferAmount: o.transferAmount,
    paid: o.paid,
    remaining: o.remaining,
    cod: o.codAmount,
  };
}

export function toSummary(
  o: OrderRecord,
  itemsPreview: Array<{ name: string; qty: number }>,
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
    itemsPreview,
    createdByName: o.createdByName,
    placedAt: o.placedAt.toISOString(),
  };
}

export function toOrderDto(
  o: OrderRecord,
  items: OrderItemRecord[],
  history: HistoryRecord[],
  warehouseName: string,
): OrderDto {
  return {
    ...toSummary(
      o,
      items.slice(0, 3).map((i) => ({
        name: [i.productName, i.variantName].filter(Boolean).join(' – '),
        qty: i.qty,
      })),
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
