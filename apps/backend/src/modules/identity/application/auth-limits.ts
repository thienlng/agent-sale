import type { WindowCounter } from './ports/security.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Limits that hold per account or per address across every API process (`WindowCounter`). The
 * per-IP burst limits stay on `AttemptLimiter`. A limit is `max` events per fixed window.
 */
export const AUTH_LIMITS = {
  /** Password logins of one address from any IP; over it the account is locked for the window. */
  loginPerAccount: { max: 20, windowMs: HOUR },
  /** Code emails (and "you already have an account" notices) to one address. */
  emailsPerHour: { max: 3, windowMs: HOUR },
  emailsPerDay: { max: 5, windowMs: DAY },
  /** Code checks for one address and purpose, across resends; over it every check is refused. */
  codeChecksPerDay: { max: 20, windowMs: DAY },
} as const;

/** Seconds to wait when `key` is over `limit` (this event counted), else 0. */
export async function overLimit(
  counter: WindowCounter,
  key: string,
  limit: { max: number; windowMs: number },
): Promise<number> {
  const { count, retryAfterSeconds } = await counter.hit(key, limit.windowMs);
  return count > limit.max ? Math.max(1, retryAfterSeconds) : 0;
}
