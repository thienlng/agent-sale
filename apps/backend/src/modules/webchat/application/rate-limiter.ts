import { InMemoryLimiter, type Limiter } from '../../../common/limits/limiter.js';

/**
 * Fixed-window counters for the public widget routes. Production binds the shared Redis limiter
 * (`sharedLimiter()`), so every API process sees the same counts and keys expire on their own
 * (security audit #17); tests and development without Redis use the bounded in-process one.
 */
export type RateLimiter = Limiter;
export const RATE_LIMITER = Symbol('RATE_LIMITER');

/** Bounded in-process limiter (oldest key evicted under a flood of distinct keys). */
export class InMemoryRateLimiter extends InMemoryLimiter {}
