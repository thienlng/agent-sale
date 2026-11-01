/**
 * A Rapiz order as a KiotViet `POST /orders` body, and KiotViet order statuses read back (spec §7).
 * Pure. The status numbers and the `customer` / `orderDelivery` field names are best guesses from the
 * public guide: they live here only, listed under "Still to verify" in `docs/integrations/kiotviet.md`.
 */

/** KiotViet order statuses (not documented in the guide; to verify on a trial store). */
export const KV_ORDER_STATUS = {
  draft: 1,
  delivering: 2,
  completed: 3,
  cancelled: 4,
  confirmed: 5,
} as const;

/** Field of the order body carrying the buyer (PR 3 replaces it with a found-or-created id). */
export const KV_ORDER_CUSTOMER_FIELD = 'customer';
/** Field of the order body carrying the receiver, address and delivery price. */
export const KV_ORDER_DELIVERY_FIELD = 'orderDelivery';

/** The mark that ties a KiotViet order to its Rapiz order (idempotency after an ambiguous failure). */
export const RAPIZ_CODE_MARK = (code: string): string => `Rapiz ${code}`;

/** The order fields this mapping reads (the commerce `PushableOrder`, money in integer VND). */
export interface PushOrder {
  code: string;
  placedAt: Date;
  note: string;
  lines: Array<{
    externalVariantId: string;
    sku: string;
    name: string;
    qty: number;
    unitPrice: number;
    /** Discount of the whole line. */
    lineDiscount: number;
  }>;
  discount: number;
  shippingFee: number;
  total: number;
  customer: { name: string; phone: string | null };
  recipient: { name: string; phone: string | null; address: string };
}

export interface KvOrderDetail {
  productId: number;
  productCode: string;
  productName: string;
  quantity: number;
  price: number;
  /** Per unit. */
  discount: number;
}

export interface KvOrderBody {
  branchId: number;
  purchaseDate: string;
  description: string;
  /** The order discount. */
  discount: number;
  orderDetails: KvOrderDetail[];
  [KV_ORDER_CUSTOMER_FIELD]?: { name: string; contactNumber: string | null };
  [KV_ORDER_DELIVERY_FIELD]: {
    receiver: string;
    contactNumber: string | null;
    address: string;
    price: number;
  };
}

/**
 * The KiotViet order body. The description starts with `RAPIZ_CODE_MARK(code)`. A line discount
 * goes per unit when it divides by the quantity, otherwise into the order discount. Rapiz's total
 * also carries the surcharge, which has no free-form field in KiotViet (`surchages` needs a
 * surcharge configured in the store): the difference between Rapiz's total and the lines minus the
 * discount plus the shipping fee goes into the delivery price (or, if negative, the order
 * discount), so `kiotVietOrderTotal(body) === o.total`.
 */
export function kiotVietOrderBody(o: PushOrder, branchId: number): KvOrderBody {
  let discount = o.discount;
  const orderDetails = o.lines.map((l): KvOrderDetail => {
    const perUnit = l.qty > 0 && l.lineDiscount % l.qty === 0 ? l.lineDiscount / l.qty : 0;
    if (perUnit * l.qty !== l.lineDiscount) discount += l.lineDiscount;
    return {
      productId: Number(l.externalVariantId),
      productCode: l.sku,
      productName: l.name,
      quantity: l.qty,
      price: l.unitPrice,
      discount: perUnit,
    };
  });
  const lines = orderDetails.reduce((sum, d) => sum + d.quantity * (d.price - d.discount), 0);
  const gap = o.total - (lines - discount + o.shippingFee);
  const deliveryPrice = o.shippingFee + Math.max(0, gap);
  discount += Math.max(0, -gap);

  const note = o.note.trim();
  const customerName = o.customer.name.trim();
  const body: KvOrderBody = {
    branchId,
    purchaseDate: o.placedAt.toISOString(),
    description: note ? `${RAPIZ_CODE_MARK(o.code)}\n${note}` : RAPIZ_CODE_MARK(o.code),
    discount,
    orderDetails,
    [KV_ORDER_DELIVERY_FIELD]: {
      receiver: o.recipient.name,
      contactNumber: o.recipient.phone,
      address: o.recipient.address,
      price: deliveryPrice,
    },
  };
  if (customerName || o.customer.phone) {
    body[KV_ORDER_CUSTOMER_FIELD] = { name: customerName, contactNumber: o.customer.phone };
  }
  return body;
}

/** What KiotViet charges for the body: lines net of their discounts, minus the order discount, plus delivery. */
export function kiotVietOrderTotal(body: KvOrderBody): number {
  const lines = body.orderDetails.reduce((sum, d) => sum + d.quantity * (d.price - d.discount), 0);
  return lines - body.discount + body[KV_ORDER_DELIVERY_FIELD].price;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether a KiotViet description carries this Rapiz code's mark as a whole token. */
export function carriesRapizCode(description: string | null, code: string): boolean {
  if (!description) return false;
  return new RegExp(`(^|\\s)${escapeRegExp(RAPIZ_CODE_MARK(code))}(\\s|$)`).test(description);
}

const STATUS_NAMES = new Map<number, string>(
  Object.entries(KV_ORDER_STATUS).map(([name, n]) => [n, name]),
);

/** A KiotViet status number as the code Rapiz stores; unknown numbers stay visible as `status_<n>`. */
export function orderStatusOf(status: number): { code: string; cancelled: boolean } {
  return {
    code: STATUS_NAMES.get(status) ?? `status_${status}`,
    cancelled: status === KV_ORDER_STATUS.cancelled,
  };
}
