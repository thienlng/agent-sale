const DAY_MS = 86_400_000;

/** A reservation older than this no longer holds allowance (its process died before deciding). */
export const RESERVATION_TTL_MS = 15 * 60_000;

/**
 * Where the cycles of an account without a subscription start: midnight in Vietnam
 * (Asia/Ho_Chi_Minh, UTC+7), so free allowances reset at 00:00 local time.
 */
export const FREE_CYCLE_ANCHOR = new Date('2026-01-01T00:00:00+07:00');

/**
 * The allowance cycle containing `now`: cycles start at `anchor` and last `periodDays` whole days
 * (24 h each, so the reset happens at the anchor's time of day; ADR-012 §5). Before the anchor,
 * the first cycle applies.
 */
export function cycleOf(
  anchor: Date,
  periodDays: number,
  now: Date = new Date(),
): { start: Date; end: Date } {
  const length = Math.max(1, Math.trunc(periodDays)) * DAY_MS;
  const elapsed = now.getTime() - anchor.getTime();
  const index = Math.max(0, Math.floor(elapsed / length));
  const start = new Date(anchor.getTime() + index * length);
  return { start, end: new Date(start.getTime() + length) };
}

/** Store answer for one reservation inside the account lock. */
export type ReserveResult = 'reserved' | 'already_captured' | 'exhausted';
