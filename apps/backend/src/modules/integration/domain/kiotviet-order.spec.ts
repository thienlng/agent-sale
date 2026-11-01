import { describe, expect, it } from 'vitest';

import {
  carriesRapizCode,
  KV_ORDER_STATUS,
  kiotVietOrderBody,
  kiotVietOrderTotal,
  orderStatusOf,
  type PushOrder,
  RAPIZ_CODE_MARK,
} from './kiotviet-order.js';

const order = (over: Partial<PushOrder> = {}): PushOrder => ({
  code: 'DH0012',
  placedAt: new Date('2026-11-01T03:04:05.000Z'),
  note: 'Giao giờ hành chính',
  lines: [
    {
      externalVariantId: '501',
      sku: 'AO-S',
      name: 'Áo thun – S',
      qty: 2,
      unitPrice: 150_000,
      lineDiscount: 0,
    },
    {
      externalVariantId: '502',
      sku: 'QUAN-M',
      name: 'Quần – M',
      qty: 1,
      unitPrice: 200_000,
      lineDiscount: 0,
    },
  ],
  discount: 20_000,
  shippingFee: 30_000,
  total: 510_000,
  customer: { name: 'Chị Lan', phone: '0901234567' },
  recipient: { name: 'Chị Lan', phone: '0901234567', address: '1 Lê Lợi, Bến Nghé, TP HCM' },
  ...over,
});

describe('kiotVietOrderBody', () => {
  it('maps lines, discount, customer and delivery to the KiotViet order', () => {
    const body = kiotVietOrderBody(order(), 7);
    expect(body).toEqual({
      branchId: 7,
      purchaseDate: '2026-11-01T03:04:05.000Z',
      description: 'Rapiz DH0012\nGiao giờ hành chính',
      discount: 20_000,
      orderDetails: [
        {
          productId: 501,
          productCode: 'AO-S',
          productName: 'Áo thun – S',
          quantity: 2,
          price: 150_000,
          discount: 0,
        },
        {
          productId: 502,
          productCode: 'QUAN-M',
          productName: 'Quần – M',
          quantity: 1,
          price: 200_000,
          discount: 0,
        },
      ],
      customer: { name: 'Chị Lan', contactNumber: '0901234567' },
      orderDelivery: {
        receiver: 'Chị Lan',
        contactNumber: '0901234567',
        address: '1 Lê Lợi, Bến Nghé, TP HCM',
        price: 30_000,
      },
    });
    expect(kiotVietOrderTotal(body)).toBe(510_000);
  });

  it('starts the description with the Rapiz code mark, even without a note', () => {
    const body = kiotVietOrderBody(order({ note: '' }), 1);
    expect(body.description).toBe(RAPIZ_CODE_MARK('DH0012'));
  });

  it('folds a surcharge into the delivery price so the KiotViet total equals Rapiz', () => {
    const body = kiotVietOrderBody(order({ total: 525_000 }), 1);
    expect(body.orderDelivery.price).toBe(45_000);
    expect(body.discount).toBe(20_000);
    expect(kiotVietOrderTotal(body)).toBe(525_000);
  });

  it('a total below the lines adds the difference to the order discount', () => {
    const body = kiotVietOrderBody(order({ total: 500_000 }), 1);
    expect(body.discount).toBe(30_000);
    expect(body.orderDelivery.price).toBe(30_000);
    expect(kiotVietOrderTotal(body)).toBe(500_000);
  });

  it('sends a line discount per unit when it divides, otherwise into the order discount', () => {
    const lines = order().lines.map((l, i) => ({ ...l, lineDiscount: i === 0 ? 10_000 : 3 }));
    const body = kiotVietOrderBody(order({ lines, total: 510_000 - 10_000 - 3 }), 1);
    expect(body.orderDetails.map((d) => d.discount)).toEqual([5_000, 3]);

    const odd = order().lines.map((l, i) => ({ ...l, lineDiscount: i === 0 ? 3 : 0 }));
    const oddBody = kiotVietOrderBody(order({ lines: odd, total: 510_000 - 3 }), 1);
    expect(oddBody.orderDetails[0]?.discount).toBe(0);
    expect(oddBody.discount).toBe(20_003);
    expect(kiotVietOrderTotal(oddBody)).toBe(510_000 - 3);
  });

  it('omits the customer when the order has neither a name nor a phone', () => {
    const body = kiotVietOrderBody(order({ customer: { name: ' ', phone: null } }), 1);
    expect(body.customer).toBeUndefined();
  });
});

describe('carriesRapizCode', () => {
  it('matches the mark as a whole token, not a longer code', () => {
    expect(carriesRapizCode('Rapiz DH0012\nnote', 'DH0012')).toBe(true);
    expect(carriesRapizCode('Rapiz DH0012', 'DH0012')).toBe(true);
    expect(carriesRapizCode('Khách cũ. Rapiz DH0012 giao sáng', 'DH0012')).toBe(true);
    expect(carriesRapizCode('Rapiz DH00123', 'DH0012')).toBe(false);
    expect(carriesRapizCode('Rapiz DH0012', 'DH001')).toBe(false);
    expect(carriesRapizCode(null, 'DH0012')).toBe(false);
  });
});

describe('orderStatusOf', () => {
  it('names the known statuses and flags the cancellation', () => {
    expect(orderStatusOf(KV_ORDER_STATUS.draft)).toEqual({ code: 'draft', cancelled: false });
    expect(orderStatusOf(KV_ORDER_STATUS.completed)).toEqual({
      code: 'completed',
      cancelled: false,
    });
    expect(orderStatusOf(KV_ORDER_STATUS.cancelled)).toEqual({
      code: 'cancelled',
      cancelled: true,
    });
  });

  it('keeps an unknown status as its number', () => {
    expect(orderStatusOf(42)).toEqual({ code: 'status_42', cancelled: false });
  });
});
