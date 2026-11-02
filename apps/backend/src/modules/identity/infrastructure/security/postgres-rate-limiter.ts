import { type Database, sql, withSystem } from '@agent-sales/db';

import type { ApiRateLimiter, RateLimitResult } from '../../application/ports/api-keys.js';

/**
 * Fixed-window counter per API key on the key's own row, so every API process shares it
 * (ADR-022 §4). One atomic upsert per request: a new window resets the count, the same window
 * adds one. A refused request still counts, which keeps a hammering client refused.
 */
export class PostgresApiRateLimiter implements ApiRateLimiter {
  constructor(
    private readonly systemDb: Database,
    private readonly clock: () => number = Date.now,
  ) {}

  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = this.clock();
    const start = new Date(now - (now % windowMs));
    return withSystem(this.systemDb, async (tx) => {
      const at = start.toISOString();
      const rows = await tx.execute<{ count: number }>(sql`
        update api_keys set
          rate_window_count = case when rate_window_start = ${at}::timestamptz then rate_window_count + 1 else 1 end,
          rate_window_start = ${at}::timestamptz
        where id = ${key}
        returning rate_window_count as count`);
      const count = Number([...rows][0]?.count ?? 1);
      const resetMs = Math.max(1, start.getTime() + windowMs - now);
      if (count > limit) return { ok: false, remaining: 0, resetMs };
      return { ok: true, remaining: limit - count, resetMs };
    });
  }
}
