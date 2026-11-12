import { createHash } from 'node:crypto';

import { type Database, sql, withSystem } from '@agent-sales/db';

import type { WindowCounter } from '../../application/ports/security.js';

/** One hit in this many also deletes a batch of ended windows. */
const SWEEP_EVERY = 200;

/**
 * `WindowCounter` on `auth_counters` (migration 0076), shared by every API process. One atomic
 * upsert per hit: an ended window restarts at 1, a live one adds 1. Keys name an address, so only
 * their sha256 is stored.
 */
export class PostgresWindowCounter implements WindowCounter {
  constructor(
    private readonly systemDb: Database,
    private readonly now: () => number = () => Date.now(),
    private readonly random: () => number = Math.random,
  ) {}

  async hit(key: string, windowMs: number): Promise<{ count: number; retryAfterSeconds: number }> {
    const t = this.now();
    const at = new Date(t).toISOString();
    const end = new Date(t + windowMs).toISOString();
    const hash = keyHash(key);
    const result = await withSystem(this.systemDb, async (tx) => {
      const rows = await tx.execute<{ count: number; window_end: string | Date }>(sql`
        insert into auth_counters (key_hash, count, window_end)
        values (${hash}, 1, ${end}::timestamptz)
        on conflict (key_hash) do update set
          count = case when auth_counters.window_end <= ${at}::timestamptz then 1
                       else auth_counters.count + 1 end,
          window_end = case when auth_counters.window_end <= ${at}::timestamptz
                            then ${end}::timestamptz else auth_counters.window_end end
        returning count, window_end`);
      const row = [...rows][0];
      const endsAt = row ? new Date(row.window_end).getTime() : t + windowMs;
      return {
        count: Number(row?.count ?? 1),
        retryAfterSeconds: Math.max(0, Math.ceil((endsAt - t) / 1000)),
      };
    });
    if (this.random() * SWEEP_EVERY < 1) await this.#sweep(at);
    return result;
  }

  /**
   * Deletes a batch of ended windows, best effort and in its own transaction: rows another hit
   * holds are skipped (no lock waits, no deadlock with the upserts), and a failure is ignored.
   */
  async #sweep(at: string): Promise<void> {
    try {
      await withSystem(this.systemDb, (tx) =>
        tx.execute(sql`
          delete from auth_counters where key_hash in (
            select key_hash from auth_counters where window_end < ${at}::timestamptz
            limit 1000 for update skip locked)`),
      );
    } catch {
      // The next sweep tries again; counting must not fail because cleanup did.
    }
  }

  async reset(key: string): Promise<void> {
    await withSystem(this.systemDb, (tx) =>
      tx.execute(sql`delete from auth_counters where key_hash = ${keyHash(key)}`),
    );
  }
}

function keyHash(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
