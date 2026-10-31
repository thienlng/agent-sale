import type { ProductDto } from '@agent-sales/contracts';
import { formatVnd, normalizeVnPhone } from '@agent-sales/shared';

import type {
  BotOrderItemInput,
  BotOrderProblem,
  BotOrderRecipient,
  CommerceFacade,
} from '../../commerce/api/index.js';

/** An order summary the customer already received before the case's turn (case `order_draft`). */
export interface EvalOrderDraft {
  items: BotOrderItemInput[];
  recipient: BotOrderRecipient;
  note?: string | undefined;
}

interface Draft {
  summaryText: string;
  lines: { variantKey: string; qty: number }[];
  storedAt: Date;
}

/** The first order code the fake hands out (`DH000001`, then `DH000002`…). */
export const EVAL_FIRST_ORDER_CODE = 'DH000001';

const orderCode = (n: number): string => `DH${String(n).padStart(6, '0')}`;

/**
 * The in-memory commerce facade of a case: the bot order flow on the case's catalog, deterministic
 * and without a database. It mirrors the real `BotOrderService` contract (problem codes, catalog
 * prices, stock = the variant's available units, a summary in the same layout as
 * `buildOrderSummary`, one draft per case) but none of its storage, locking or review rules; those
 * have their own unit and integration tests in the commerce module. `seed` stores a draft dated
 * before the turn, so a case can start at "the customer answers the summary".
 */
export function evalCommerce(
  products: readonly ProductDto[],
  seed?: { draft: EvalOrderDraft; shippingFeeVnd: number | null },
): CommerceFacade {
  const bySku = new Map(
    products.flatMap((p) =>
      p.variants.map((v) => [v.sku.toLowerCase(), { product: p, variant: v }] as const),
    ),
  );
  const available = new Map(
    products.flatMap((p) =>
      p.variants.map((v) => [v.id, v.stock.reduce((sum, s) => sum + s.available, 0)] as const),
    ),
  );
  let draft: Draft | null = null;
  let orders = 0;

  const prepare = (
    input: { items: BotOrderItemInput[]; recipient: BotOrderRecipient; note?: string | undefined },
    shippingFeeVnd: number | null,
    storedAt: Date,
  ):
    | { ok: true; draft: Draft; productIds: string[] }
    | { ok: false; problems: BotOrderProblem[] } => {
    const problems: BotOrderProblem[] = [];
    const merged = new Map<string, number>();
    for (const item of input.items) {
      const key = item.sku.trim().toLowerCase();
      merged.set(key, (merged.get(key) ?? 0) + item.qty);
    }
    const lines = [...merged].flatMap(([sku, qty]) => {
      const hit = bySku.get(sku);
      if (!hit) {
        problems.push({ code: 'unknown_sku', sku });
        return [];
      }
      const left = available.get(hit.variant.id) ?? 0;
      if (left < qty) problems.push({ code: 'insufficient_stock', sku, available: left });
      return [{ ...hit, qty }];
    });
    const { name, phone, address } = input.recipient;
    if (!name.trim()) problems.push({ code: 'missing_name' });
    if (!phone.trim()) problems.push({ code: 'missing_phone' });
    else if (!normalizeVnPhone(phone)) problems.push({ code: 'invalid_phone' });
    if (!address.trim()) problems.push({ code: 'missing_address' });
    if (problems.length) return { ok: false, problems };

    const subtotal = lines.reduce((sum, l) => sum + l.variant.price * l.qty, 0);
    const note = input.note?.trim();
    const summaryText = [
      'Dạ em tóm tắt đơn của mình ạ:',
      ...lines.map(
        (l) =>
          `• ${l.product.name} (${l.variant.name}) ×${l.qty} — ${formatVnd(l.variant.price * l.qty)}`,
      ),
      shippingFeeVnd === null ? 'Phí ship: shop báo sau' : `Phí ship: ${formatVnd(shippingFeeVnd)}`,
      `Tổng: ${formatVnd(subtotal + (shippingFeeVnd ?? 0))}`,
      `Người nhận: ${name.trim()} · ${phone.trim()}`,
      `Địa chỉ: ${address.trim()}`,
      ...(note ? [`Ghi chú: ${note}`] : []),
    ].join('\n');
    return {
      ok: true,
      draft: {
        summaryText,
        lines: lines.map((l) => ({ variantKey: l.variant.id, qty: l.qty })),
        storedAt,
      },
      productIds: [...new Set(lines.map((l) => l.product.id))],
    };
  };

  if (seed) {
    const seeded = prepare(seed.draft, seed.shippingFeeVnd, new Date(0));
    if (!seeded.ok)
      throw new Error(`order_draft is not a valid order: ${JSON.stringify(seeded.problems)}`);
    draft = seeded.draft;
  }

  return {
    getOrder: () => Promise.reject(new Error('getOrder is not part of the eval fake')),
    prepareBotOrder: async (_ws, input) => {
      const res = prepare(input, input.shippingFeeVnd, new Date());
      if (!res.ok) return res;
      draft = res.draft;
      return { ok: true, summaryText: res.draft.summaryText, productIds: res.productIds };
    },
    confirmBotOrder: async () => {
      if (!draft) return { ok: false, code: 'nothing_pending' };
      const taken = draft;
      draft = null;
      if (taken.lines.some((l) => (available.get(l.variantKey) ?? 0) < l.qty))
        return { ok: false, code: 'insufficient_stock' };
      for (const l of taken.lines)
        available.set(l.variantKey, (available.get(l.variantKey) ?? 0) - l.qty);
      orders += 1;
      return { ok: true, orderId: `eval-order-${orders}`, orderCode: orderCode(orders) };
    },
    cancelBotOrderDraft: async () => {
      const had = draft !== null;
      draft = null;
      return had;
    },
    hasBotOrderDraft: async () => ({ pending: draft !== null, storedAt: draft?.storedAt ?? null }),
  };
}
