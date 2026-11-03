import type {
  CustomerRequestKind,
  RequestProfile,
  RequestStatusMove,
} from '@agent-sales/contracts';
import { vietnameseDateLabel } from '@agent-sales/shared';

/**
 * Pure rules of a bot-recorded customer request (ESV spec §5.1; ADR-020 generalised): the note
 * staff read, the status move, the server-computed day label and the past-date check.
 */

/** Signature of the notes the bot leaves on a customer. */
export const BOT_AUTHOR = 'Bot AI';

/** A second request of the same kind within this window updates the first. */
export const UPDATE_WINDOW_MS = 24 * 3_600_000;

/** The business time zone of every request industry today (Vietnam). */
const REQUEST_TIME_ZONE_OFFSET_MS = 7 * 3_600_000;

/**
 * "Thứ Bảy 07/11/2026" for `2026-11-07`; null for a value that is not a YYYY-MM-DD date. The
 * shared helper keeps the spelling identical to lodging and the eval writer.
 */
export const dateLabel = vietnameseDateLabel;

/** Today's calendar date in Asia/Ho_Chi_Minh (UTC+7, no daylight saving). */
export function localToday(now: Date): string {
  return new Date(now.getTime() + REQUEST_TIME_ZONE_OFFSET_MS).toISOString().slice(0, 10);
}

/** True when the date is before today in Asia/Ho_Chi_Minh (today itself is not past). */
export function isPastDate(yyyyMmDd: string, now: Date): boolean {
  return yyyyMmDd < localToday(now);
}

/**
 * The note the bot leaves on the customer: what was asked and what the customer said, one line per
 * given detail in the profile's field order. `phone` has no line (it identifies the customer); a
 * `preferredDate` is written as its day label. Staff read it in Vietnamese (business content). The
 * saas text is byte-identical to the ADR-020 `leadNote`.
 */
export function requestNote(
  profile: RequestProfile,
  kind: CustomerRequestKind,
  details: Readonly<Record<string, unknown>>,
  update: boolean,
): string {
  const head = `${profile.kindLabels[kind] ?? kind} (bot ghi nhận)`;
  const lines: string[] = [update ? `Cập nhật: ${head}` : head];
  for (const field of profile.fields) {
    if (field.key === 'phone') continue;
    const value = details[field.key];
    if (typeof value !== 'string' || !value.trim()) continue;
    const shown = field.key === 'preferredDate' ? (dateLabel(value) ?? value) : value;
    lines.push(`${field.label}: ${shown}`);
  }
  return lines.join('\n');
}

/**
 * The details kept in the history entry: every given field except `phone` and `email` (contact
 * data stays on the customer), empty ones dropped, in the profile's field order.
 */
export function historyDetails(
  profile: RequestProfile,
  details: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of profile.fields) {
    if (field.key === 'phone' || field.key === 'email') continue;
    const value = details[field.key];
    if (typeof value === 'string' && value.trim()) out[field.key] = value;
  }
  return out;
}

/**
 * Whether a request moves the customer to `move.key`. `currentKey` is the built-in key of the
 * customer's status (null: none or a custom status). `positions` are the pipeline positions of the
 * current status (null: none) and of the target.
 *
 * - `forward_only` (saas, ADR-020): never back, never sideways: moves only when the customer has no
 *   status or one earlier in the pipeline order.
 * - `unless`: moves unless the customer is already at the target or at a `keep` (confirmed) status.
 */
export function decideStatusMove(
  move: RequestStatusMove,
  currentKey: string | null,
  positions: { current: number | null; target: number },
): boolean {
  if (currentKey !== null && currentKey === move.key) return false;
  if (move.move === 'forward_only')
    return positions.current === null || positions.current < positions.target;
  return currentKey === null || !move.keep.includes(currentKey);
}
