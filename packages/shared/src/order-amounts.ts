/**
 * Order money formulas (docs/05 §6 "Order amount formulas"), integer VND only.
 *
 *   subtotal        = Σ qty × unit_price
 *   discount_amount = percent ? round(subtotal × value / 100) : min(value, subtotal)
 *   after_discount  = subtotal − discount_amount
 *   charged         = free_shipping ? 0 : shipping_fee_charged
 *   gross           = subtotal + charged + surcharge            ("Tổng số tiền", before discount)
 *   total           = gross − discount_amount                   ("Tiền cần thu")
 *   paid            = transfer_amount
 *   remaining       = total − paid                              ("Còn thiếu"; < 0 = overpaid)
 *   cod             = max(remaining, 0)
 *   profit          = subtotal − cost − discount_amount − (shipping_fee − charged)
 *
 * Shared so the order form shows exactly what the server will store.
 */
export interface AmountInput {
  items: ReadonlyArray<{ qty: number; unitPrice: number; unitCost: number }>;
  discountType: 'amount' | 'percent';
  discountValue: number;
  shippingFee: number;
  shippingFeeCharged: number;
  freeShipping: boolean;
  surcharge: number;
  transferAmount: number;
}

export interface Amounts {
  itemQty: number;
  subtotal: number;
  discountType: 'amount' | 'percent';
  discountValue: number;
  discountAmount: number;
  afterDiscount: number;
  shippingFee: number;
  shippingFeeCharged: number;
  freeShipping: boolean;
  surcharge: number;
  gross: number;
  total: number;
  transferAmount: number;
  paid: number;
  remaining: number;
  cod: number;
  costTotal: number;
}

export function computeAmounts(input: AmountInput): Amounts {
  const itemQty = input.items.reduce((n, i) => n + i.qty, 0);
  const subtotal = input.items.reduce((n, i) => n + i.qty * i.unitPrice, 0);
  const costTotal = input.items.reduce((n, i) => n + i.qty * i.unitCost, 0);
  const discountAmount =
    input.discountType === 'percent'
      ? Math.round((subtotal * Math.min(input.discountValue, 100)) / 100)
      : Math.min(input.discountValue, subtotal);
  const afterDiscount = subtotal - discountAmount;
  const shippingFeeCharged = input.freeShipping ? 0 : input.shippingFeeCharged;
  const gross = subtotal + shippingFeeCharged + input.surcharge;
  const total = gross - discountAmount;
  const paid = input.transferAmount;
  const remaining = total - paid;
  return {
    itemQty,
    subtotal,
    discountType: input.discountType,
    discountValue: input.discountValue,
    discountAmount,
    afterDiscount,
    shippingFee: input.shippingFee,
    shippingFeeCharged,
    freeShipping: input.freeShipping,
    surcharge: input.surcharge,
    gross,
    total,
    transferAmount: input.transferAmount,
    paid,
    remaining,
    cod: Math.max(remaining, 0),
    costTotal,
  };
}

/** Profit of one order (statistics only count it for closed orders). */
export function orderProfit(
  a: Pick<
    Amounts,
    'subtotal' | 'costTotal' | 'discountAmount' | 'shippingFee' | 'shippingFeeCharged'
  >,
): number {
  return a.subtotal - a.costTotal - a.discountAmount - (a.shippingFee - a.shippingFeeCharged);
}
