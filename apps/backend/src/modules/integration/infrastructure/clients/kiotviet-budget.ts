import { KiotVietUnavailableError } from '../../domain/integration.errors.js';

/** Per-store request budget: bursts of 10, refilled at 4 500 requests per hour. */
const BUDGET_CAPACITY = 10;
const BUDGET_PER_SECOND = 4_500 / 3_600;
/** Interactive calls fail fast once a store's budget is this far in debt (≈ 48 s of refill). */
const MAX_BUDGET_DEBT = 60;

export interface Bucket {
  tokens: number;
  at: number;
}

/**
 * Takes one request from a store's in-memory token bucket. Returns 0 when taken, otherwise the
 * milliseconds to wait before asking again. Interactive calls never wait: they run the bucket into
 * debt (later background calls repay it) and throw `KiotVietUnavailableError` past the ceiling.
 */
export function takeFromBudget(
  buckets: Map<string, Bucket>,
  retailer: string,
  now: number,
  interactive: boolean,
): number {
  const key = retailer.trim().toLowerCase();
  const bucket = buckets.get(key) ?? { tokens: BUDGET_CAPACITY, at: now };
  bucket.tokens = Math.min(
    BUDGET_CAPACITY,
    bucket.tokens + ((now - bucket.at) / 1000) * BUDGET_PER_SECOND,
  );
  bucket.at = now;
  buckets.set(key, bucket);
  if (interactive && bucket.tokens < -MAX_BUDGET_DEBT) throw new KiotVietUnavailableError();
  if (bucket.tokens >= 1 || interactive) {
    bucket.tokens -= 1;
    return 0;
  }
  return Math.ceil(((1 - bucket.tokens) / BUDGET_PER_SECOND) * 1000);
}
