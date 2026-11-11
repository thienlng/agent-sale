import type { ImpactRange } from '@agent-sales/contracts';

import { hcmDayStart } from './care.js';

const DAY_MS = 86_400_000;
/** An order is attributed to an AI touch at most this long before it (spec §6). */
export const ATTRIBUTION_WINDOW_MS = 7 * DAY_MS;

/** A delivered outbound message of the conversation (a bot reply or care message, or staff). */
export interface Touch {
  sender: 'bot' | 'human';
  at: Date;
}

export type Attribution = 'ai' | 'ai_staff';

/**
 * How an order (or a stay booking) created at `orderAt` is attributed (spec §6): an AI touch — a
 * bot reply or a care message — in the 7 days before it is required; `ai` when no member of the
 * shop wrote between the first such touch and the order, `ai_staff` when one did. Null: no AI
 * touch in the window.
 */
export function attribute(orderAt: Date, touches: readonly Touch[]): Attribution | null {
  const from = orderAt.getTime() - ATTRIBUTION_WINDOW_MS;
  const to = orderAt.getTime();
  const ai = touches
    .filter((t) => t.sender === 'bot' && t.at.getTime() >= from && t.at.getTime() < to)
    .map((t) => t.at.getTime());
  if (!ai.length) return null;
  const first = Math.min(...ai);
  const staff = touches.some(
    (t) => t.sender === 'human' && t.at.getTime() > first && t.at.getTime() < to,
  );
  return staff ? 'ai_staff' : 'ai';
}

/** The start of an impact range: the local day, or 7 / 30 days back. */
export function rangeStart(range: ImpactRange, now: Date): Date {
  if (range === 'today') return hcmDayStart(now);
  return new Date(now.getTime() - (range === '7d' ? 7 : 30) * DAY_MS);
}

/** An order or booking to attribute. */
export interface Sale {
  conversationId: string;
  createdAt: Date;
  total: number;
}

/**
 * The attribution of a sale from the conversation module's per-sale aggregate (`aiTouches`: the
 * first AI touch in the 7 days before it, and whether staff wrote after it) — the same rule as
 * `attribute`, read in SQL so no message list is loaded.
 */
export function attributionOf(t: {
  firstBotAt: string | null;
  staffAfter: boolean;
}): Attribution | null {
  if (!t.firstBotAt) return null;
  return t.staffAfter ? 'ai_staff' : 'ai';
}

/** Sums the attributed sales (counts and integer revenue) per kind. */
export function summarize(
  sales: readonly Sale[],
  attributionOfSale: (sale: Sale, index: number) => Attribution | null,
): { ai: { orders: number; revenue: number }; aiStaff: { orders: number; revenue: number } } {
  const out = { ai: { orders: 0, revenue: 0 }, aiStaff: { orders: 0, revenue: 0 } };
  sales.forEach((s, i) => {
    const a = attributionOfSale(s, i);
    if (!a) return;
    const bucket = a === 'ai' ? out.ai : out.aiStaff;
    bucket.orders += 1;
    bucket.revenue += Math.max(0, Math.round(s.total));
  });
  return out;
}
