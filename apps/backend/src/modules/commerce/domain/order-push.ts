import { APPROVE_UNDO_WINDOW_MS } from './bot-order.js';
import type { OrderStatus } from './order-stock.js';

/**
 * Rules of pushing orders to a PMS (ADR-017, spec §7). Pure: the SQL claim in
 * `orders.drizzle.ts` applies the same eligibility.
 */

/** A bot order is pushed only once its approval can no longer be undone. */
export const PUSH_SETTLE_MS = APPROVE_UNDO_WINDOW_MS;
export const PUSH_NOTE_MAX = 500;
export const EXTERNAL_CANCELLED_HISTORY_NOTE = 'Đơn đã huỷ trên KiotViet';

export const pushedHistoryNote = (externalCode: string) => `Đã đẩy sang KiotViet (${externalCode})`;

export interface PushCandidate {
  externalState: 'pending' | 'pushed' | 'failed' | null;
  deleted: boolean;
  status: OrderStatus;
  createdAt: Date;
  createdByKind: 'agent' | 'bot' | 'import' | 'api';
  reviewState: 'pending' | 'approved' | null;
  reviewedAt: Date | null;
}

/**
 * Not pushed or claimed yet, live, created since the connection, and either a staff order or a
 * bot order approved more than `PUSH_SETTLE_MS` ago.
 */
export function isPushEligible(o: PushCandidate, since: Date, now: Date): boolean {
  if (o.externalState !== null || o.deleted || o.status === 'cancelled') return false;
  if (o.createdAt < since) return false;
  if (o.createdByKind === 'agent') return true;
  return (
    o.createdByKind === 'bot' &&
    o.reviewState === 'approved' &&
    o.reviewedAt !== null &&
    o.reviewedAt.getTime() < now.getTime() - PUSH_SETTLE_MS
  );
}

/** The internal and printed notes, one per line, at most `PUSH_NOTE_MAX` characters. */
export function pushNote(noteInternal: string, notePrint: string): string {
  return [noteInternal, notePrint]
    .map((n) => n.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, PUSH_NOTE_MAX);
}

/** One order line with its variant's PMS id (null: the product is not linked to the source). */
export interface PushLine {
  externalVariantId: string | null;
  sku: string;
  productName: string;
  variantName: string;
  qty: number;
  unitPrice: number;
}

export interface PushOrderInput {
  id: string;
  code: string;
  placedAt: Date;
  noteInternal: string;
  notePrint: string;
  discountAmount: number;
  shippingFeeCharged: number;
  total: number;
  customer: Record<string, unknown>;
  recipient: Record<string, unknown>;
}

export interface PushPayload {
  id: string;
  code: string;
  placedAt: Date;
  note: string;
  lines: Array<{
    externalVariantId: string;
    sku: string;
    name: string;
    qty: number;
    unitPrice: number;
    lineDiscount: number;
  }>;
  discount: number;
  shippingFee: number;
  total: number;
  customer: { name: string; phone: string | null };
  recipient: { name: string; phone: string | null; address: string };
}

export type PushProblem = { reason: 'unlinked_product'; name: string } | { reason: 'empty' };

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * The PMS-neutral push payload, or why the order cannot be pushed. Money is integer VND: the
 * discount is the order's, lines carry none; the shipping fee is the one the customer pays.
 */
export function pushPayload(
  o: PushOrderInput,
  lines: PushLine[],
): { order: PushPayload } | { problem: PushProblem } {
  if (!lines.length) return { problem: { reason: 'empty' } };
  const unlinked = lines.find((l) => !l.externalVariantId);
  if (unlinked) return { problem: { reason: 'unlinked_product', name: unlinked.productName } };
  const r = o.recipient;
  return {
    order: {
      id: o.id,
      code: o.code,
      placedAt: o.placedAt,
      note: pushNote(o.noteInternal, o.notePrint),
      lines: lines.map((l) => ({
        externalVariantId: l.externalVariantId ?? '',
        sku: l.sku,
        name: [l.productName, l.variantName].filter(Boolean).join(' – '),
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineDiscount: 0,
      })),
      discount: o.discountAmount,
      shippingFee: o.shippingFeeCharged,
      total: o.total,
      customer: { name: text(o.customer['name']), phone: text(o.customer['phone']) || null },
      recipient: {
        name: text(r['name']),
        phone: text(r['phone']) || null,
        address: [r['address'], r['ward'], r['province']].map(text).filter(Boolean).join(', '),
      },
    },
  };
}
