import { normalizeVnPhone } from '@agent-sales/shared';

/** Rules of orders the bot prepares in chat and staff review afterwards (spec §4, ADR-016). */

export const BOT_ORDER_DRAFT_TTL_MS = 30 * 60 * 1000;
/** How long the reviewer who approved a bot order may take it back. */
export const APPROVE_UNDO_WINDOW_MS = 5_000;
export const BOT_ORDER_HISTORY_NOTE = 'Bot tạo đơn từ hội thoại';
export const APPROVED_HISTORY_NOTE = 'Đã duyệt đơn do bot tạo';
export const APPROVAL_UNDONE_HISTORY_NOTE = 'Đã hoàn tác duyệt đơn';

const LIMITS = { name: 120, address: 300, note: 300 } as const;
/** Conversation channels that are also order sources; anything else is recorded as `other`. */
const CHANNEL_SOURCES: ReadonlySet<string> = new Set(['facebook', 'instagram', 'website', 'zalo']);

export type RecipientProblem =
  'missing_name' | 'missing_phone' | 'invalid_phone' | 'missing_address';

export interface CleanRecipient {
  name: string;
  /** National form `0xxxxxxxxx`. */
  phone: string;
  phoneE164: string;
  address: string;
}

const tidy = (text: string | undefined, max: number) =>
  (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Trimmed recipient with a normalized Vietnamese mobile number, or what is missing or wrong. */
export function checkRecipient(input: { name?: string; phone?: string; address?: string }): {
  recipient: CleanRecipient | null;
  problems: RecipientProblem[];
} {
  const name = tidy(input.name, LIMITS.name);
  const address = tidy(input.address, LIMITS.address);
  const rawPhone = (input.phone ?? '').trim();
  const phoneE164 = rawPhone ? normalizeVnPhone(rawPhone) : null;
  const problems: RecipientProblem[] = [];
  if (!name) problems.push('missing_name');
  if (!rawPhone) problems.push('missing_phone');
  else if (!phoneE164) problems.push('invalid_phone');
  if (!address) problems.push('missing_address');
  if (problems.length || !phoneE164) return { recipient: null, problems };
  return { recipient: { name, phone: `0${phoneE164.slice(3)}`, phoneE164, address }, problems };
}

export function cleanNote(note: string | undefined): string | null {
  return tidy(note, LIMITS.note) || null;
}

/** Lines by SKU (trimmed, case-insensitive like the catalog), quantities of repeats added up. */
export function mergeItems(items: ReadonlyArray<{ sku: string; qty: number }>): Array<{
  sku: string;
  qty: number;
}> {
  const merged = new Map<string, { sku: string; qty: number }>();
  for (const item of items) {
    const sku = item.sku.trim();
    const qty = Math.trunc(item.qty);
    if (!sku || !(qty > 0)) continue;
    const key = sku.toLowerCase();
    const line = merged.get(key);
    if (line) line.qty += qty;
    else merged.set(key, { sku, qty });
  }
  return [...merged.values()];
}

export function orderSourceOf(channel: string): string {
  return CHANNEL_SOURCES.has(channel) ? channel : 'other';
}

/**
 * Only a customer channel has an inbox conversation to open; the dashboard test chat keys its
 * draft by a synthetic id that is not a conversation, so its orders link to nothing.
 */
export function linkedConversationId(channel: string, conversationId: string): string | null {
  return CHANNEL_SOURCES.has(channel) ? conversationId : null;
}

/**
 * The idempotency key of the order a draft becomes (spec §4.5, plus the draft's nonce): retrying
 * one draft never creates a second order, while the same basket ordered again later (a new draft
 * in the same conversation) is a new order.
 */
export function botOrderRequestId(
  conversationId: string,
  amountsHash: string,
  draftStoredAt: Date,
): string {
  return `bot:${conversationId}:${amountsHash}:${draftStoredAt.getTime()}`;
}

/**
 * Canonical text the draft's `amounts_hash` is computed from: what the customer saw and agreed
 * to (lines with their catalog prices, shipping, recipient, note). A price change since the
 * summary yields another hash.
 */
export function amountsFingerprint(input: {
  lines: ReadonlyArray<{ variantId: string; qty: number; unitPrice: number }>;
  shippingFee: number | null;
  recipient: { name: string; phone: string; address: string };
  note: string | null;
}): string {
  return JSON.stringify([
    input.lines.map((l) => [l.variantId, l.qty, l.unitPrice]),
    input.shippingFee,
    [input.recipient.name, input.recipient.phone, input.recipient.address],
    input.note,
  ]);
}

export type ReviewDecision = 'approve' | 'unchanged' | 'revert' | 'undo_not_allowed';

/**
 * What an approve call does: approving is idempotent; reverting is allowed only to the user who
 * approved, within APPROVE_UNDO_WINDOW_MS of the approval.
 */
export function reviewDecision(
  current: {
    reviewState: 'pending' | 'approved';
    reviewedByUserId: string | null;
    reviewedAt: Date | null;
  },
  approve: boolean,
  actorUserId: string,
  now: Date,
): ReviewDecision {
  if (approve) return current.reviewState === 'approved' ? 'unchanged' : 'approve';
  if (current.reviewState === 'pending') return 'unchanged';
  const recent =
    current.reviewedAt !== null &&
    now.getTime() - current.reviewedAt.getTime() <= APPROVE_UNDO_WINDOW_MS;
  return recent && current.reviewedByUserId === actorUserId ? 'revert' : 'undo_not_allowed';
}

/** Why a stored draft cannot become its order; thrown so the confirming transaction rolls back. */
export class DraftNotConfirmable extends Error {
  readonly code: 'expired' | 'insufficient_stock';
  readonly draftStoredAt: Date;
  constructor(code: 'expired' | 'insufficient_stock', draftStoredAt: Date) {
    super(code);
    this.code = code;
    this.draftStoredAt = draftStoredAt;
  }
}
