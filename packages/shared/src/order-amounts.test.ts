import { describe, expect, it } from 'vitest';

import { computeAmounts, orderProfit } from './order-amounts.js';

const base = {
  items: [
    { qty: 2, unitPrice: 150_000, unitCost: 90_000 },
    { qty: 1, unitPrice: 200_000, unitCost: 120_000 },
  ],
  discountType: 'amount' as const,
  discountValue: 0,
  shippingFee: 30_000,
  shippingFeeCharged: 30_000,
  freeShipping: false,
  surcharge: 0,
  transferAmount: 0,
};

describe('computeAmounts (docs/05 formulas)', () => {
  it('adds goods, shipping charged and surcharge; COD is what is still owed', () => {
    const a = computeAmounts({ ...base, surcharge: 5_000, transferAmount: 100_000 });
    expect(a).toMatchObject({
      itemQty: 3,
      subtotal: 500_000,
      afterDiscount: 500_000,
      total: 535_000,
      paid: 100_000,
      remaining: 435_000,
      cod: 435_000,
      costTotal: 300_000,
    });
  });

  it('applies a percentage discount with rounding, and caps both kinds', () => {
    expect(
      computeAmounts({ ...base, discountType: 'percent', discountValue: 15 }).discountAmount,
    ).toBe(75_000);
    expect(
      computeAmounts({
        ...base,
        items: [{ qty: 1, unitPrice: 99_999, unitCost: 0 }],
        discountType: 'percent',
        discountValue: 10,
      }).discountAmount,
    ).toBe(10_000);
    expect(computeAmounts({ ...base, discountValue: 900_000 }).discountAmount).toBe(500_000);
    expect(
      computeAmounts({ ...base, discountType: 'percent', discountValue: 150 }).discountAmount,
    ).toBe(500_000);
  });

  it('free shipping charges the customer nothing; the shop still pays the carrier', () => {
    const a = computeAmounts({ ...base, freeShipping: true });
    expect(a.shippingFeeCharged).toBe(0);
    expect(a.total).toBe(500_000);
    expect(orderProfit(a)).toBe(500_000 - 300_000 - 30_000);
  });

  it('an overpaid order has a negative remaining and no COD', () => {
    const a = computeAmounts({ ...base, transferAmount: 600_000 });
    expect(a.remaining).toBe(-70_000);
    expect(a.cod).toBe(0);
  });

  it('profit subtracts cost, discount and the shipping the shop absorbs', () => {
    const a = computeAmounts({ ...base, discountValue: 50_000, shippingFeeCharged: 20_000 });
    expect(orderProfit(a)).toBe(500_000 - 300_000 - 50_000 - 10_000);
  });
});
