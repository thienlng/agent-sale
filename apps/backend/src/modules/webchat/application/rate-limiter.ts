/** Fixed-window counter per key. */
export interface RateLimiter {
  /** Counts one hit; `ok` is false once `limit` hits were counted inside the current window. */
  hit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterMs: number };
}
export const RATE_LIMITER = Symbol('RATE_LIMITER');

const MAX_KEYS = 50_000;
const SWEEP_EVERY_MS = 30_000;

/**
 * In-process limiter (docs/09 deviation: the spec names Redis; one API process is enough until
 * the API scales out, and the port lets a Redis adapter replace this without touching callers).
 * Expired windows are swept periodically; at `MAX_KEYS` the oldest window is evicted, so memory
 * stays bounded under a flood of distinct keys.
 */
export class InMemoryRateLimiter implements RateLimiter {
  readonly #windows = new Map<string, { start: number; count: number; windowMs: number }>();
  #lastSweep = Date.now();

  hit(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    this.#sweep(now);
    let w = this.#windows.get(key);
    if (!w || now - w.start >= windowMs) {
      if (!w && this.#windows.size >= MAX_KEYS) {
        const oldest = this.#windows.keys().next().value;
        if (oldest !== undefined) this.#windows.delete(oldest);
      }
      this.#windows.delete(key);
      w = { start: now, count: 0, windowMs };
      this.#windows.set(key, w);
    }
    if (w.count >= limit) return { ok: false, retryAfterMs: Math.max(1, w.start + windowMs - now) };
    w.count += 1;
    return { ok: true, retryAfterMs: 0 };
  }

  #sweep(now: number): void {
    if (now - this.#lastSweep < SWEEP_EVERY_MS) return;
    this.#lastSweep = now;
    for (const [key, w] of this.#windows)
      if (now - w.start >= w.windowMs) this.#windows.delete(key);
  }
}
