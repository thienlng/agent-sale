import type { WindowCounter } from '../../application/ports/security.js';

const MAX_KEYS = 50_000;

/**
 * `WindowCounter` in process: for tests and a backend running without a database. Memory stays
 * bounded: at `MAX_KEYS` the oldest window is evicted.
 */
export class InMemoryWindowCounter implements WindowCounter {
  readonly #windows = new Map<string, { count: number; endsAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async hit(key: string, windowMs: number): Promise<{ count: number; retryAfterSeconds: number }> {
    const t = this.now();
    let w = this.#windows.get(key);
    if (!w || w.endsAt <= t) {
      this.#windows.delete(key);
      if (this.#windows.size >= MAX_KEYS) {
        const oldest = this.#windows.keys().next().value;
        if (oldest !== undefined) this.#windows.delete(oldest);
      }
      w = { count: 0, endsAt: t + windowMs };
      this.#windows.set(key, w);
    }
    w.count += 1;
    return { count: w.count, retryAfterSeconds: Math.ceil((w.endsAt - t) / 1000) };
  }

  async reset(key: string): Promise<void> {
    this.#windows.delete(key);
  }
}
