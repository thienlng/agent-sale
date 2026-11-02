import type { ApiRateLimiter, RateLimitResult } from '../../application/ports/api-keys.js';

const MAX_KEYS = 50_000;

/**
 * Fixed-window counter per API key, in process (ADR-022 §4 names Redis: same deviation as the
 * webchat limiter — one API process today; a Redis adapter replaces this behind the port when
 * the API scales out). Memory stays bounded: at `MAX_KEYS` the oldest window is evicted.
 */
export class InMemoryApiRateLimiter implements ApiRateLimiter {
  readonly #windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly clock: () => number = Date.now) {}

  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = this.clock();
    let w = this.#windows.get(key);
    if (!w || now - w.start >= windowMs) {
      this.#windows.delete(key);
      if (this.#windows.size >= MAX_KEYS) {
        const oldest = this.#windows.keys().next().value;
        if (oldest !== undefined) this.#windows.delete(oldest);
      }
      w = { start: now, count: 0 };
      this.#windows.set(key, w);
    }
    const resetMs = Math.max(1, w.start + windowMs - now);
    if (w.count >= limit) return Promise.resolve({ ok: false, remaining: 0, resetMs });
    w.count += 1;
    return Promise.resolve({ ok: true, remaining: limit - w.count, resetMs });
  }
}
