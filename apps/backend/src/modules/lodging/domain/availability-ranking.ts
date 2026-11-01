import { MAX_STAY_NIGHTS, nightToUtcMs } from './nights.js';

const DAY_MS = 86_400_000;
/** At most this many options reach the bot (spec §3). */
export const MAX_BOT_OPTIONS = 5;

export interface RankableOption {
  propertyId: string;
  fits: boolean;
  totalSell: number | null;
}

/** Fitting options first, then the cheapest; options without a total last. */
export function compareFitThenPrice(
  a: Pick<RankableOption, 'fits' | 'totalSell'>,
  b: Pick<RankableOption, 'fits' | 'totalSell'>,
): number {
  if (a.fits !== b.fits) return a.fits ? -1 : 1;
  const x = a.totalSell;
  const y = b.totalSell;
  if (x === y) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return x - y;
}

/**
 * The options the bot gets. Without a requested property: every free option, ranked. With one:
 * its own options while it is free; otherwise `requestedFull` and the other options as
 * alternatives. Capped at MAX_BOT_OPTIONS.
 */
export function rankForBot<T extends RankableOption>(
  options: readonly T[],
  requestedId?: string,
): { requestedFull: boolean; options: T[] } {
  const ranked = [...options].sort(compareFitThenPrice);
  if (requestedId === undefined) {
    return { requestedFull: false, options: ranked.slice(0, MAX_BOT_OPTIONS) };
  }
  const own = ranked.filter((o) => o.propertyId === requestedId);
  if (own.length) return { requestedFull: false, options: own.slice(0, MAX_BOT_OPTIONS) };
  return { requestedFull: true, options: ranked.slice(0, MAX_BOT_OPTIONS) };
}

/** A problem of the stay dates the bot asks about. */
export type BotStayProblem = 'invalid_dates' | 'past_date' | 'too_long';

/**
 * Date checks of a stay the bot asks about: real dates, check-out after check-in, check-in from
 * local `today`, 1 to 60 nights. Never throws: the bot explains every problem to the customer.
 * `nights` is 0 when the dates are invalid.
 */
export function botStayProblems(
  checkIn: string,
  checkOut: string,
  today: string,
): { nights: number; problems: BotStayProblem[] } {
  let nights: number;
  try {
    nights = (nightToUtcMs(checkOut) - nightToUtcMs(checkIn)) / DAY_MS;
  } catch {
    return { nights: 0, problems: ['invalid_dates'] };
  }
  if (nights < 1) return { nights: 0, problems: ['invalid_dates'] };
  const problems: BotStayProblem[] = [];
  if (checkIn < today) problems.push('past_date');
  if (nights > MAX_STAY_NIGHTS) problems.push('too_long');
  return { nights, problems };
}
