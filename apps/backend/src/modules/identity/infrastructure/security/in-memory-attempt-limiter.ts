import type { AttemptLimiter } from '../../application/ports/security.js';

/**
 * Fixed-window limiter, per process. Good enough for one API replica and tests;
 * replace with the Redis store before running several replicas (T-014 follow-up).
 */
export class InMemoryAttemptLimiter implements AttemptLimiter {
  readonly #windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max = 10,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async hit(key: string): Promise<number> {
    const t = this.now();
    const w = this.#windows.get(key);
    if (!w || w.resetAt <= t) {
      this.#windows.set(key, { count: 1, resetAt: t + this.windowMs });
      return 0;
    }
    w.count += 1;
    return w.count > this.max ? Math.ceil((w.resetAt - t) / 1000) : 0;
  }

  async reset(key: string): Promise<void> {
    this.#windows.delete(key);
  }
}
