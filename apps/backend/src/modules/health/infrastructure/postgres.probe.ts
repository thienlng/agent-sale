import type { ProbeResult } from '@agent-sales/contracts';
import { type Database, sql } from '@agent-sales/db';

import type { ReadinessProbe } from '../application/ports/readiness-probe.js';

/** `select 1` on the tenant connection; `skipped` when no database is configured. */
export class PostgresProbe implements ReadinessProbe {
  readonly name = 'postgres';

  constructor(private readonly db: Database | null | undefined) {}

  async check(timeoutMs: number): Promise<ProbeResult> {
    if (!this.db) return { name: this.name, status: 'skipped' };
    const started = performance.now();
    try {
      await Promise.race([
        this.db.execute(sql`select 1`),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);
      return { name: this.name, status: 'up', latencyMs: Math.round(performance.now() - started) };
    } catch (e) {
      return { name: this.name, status: 'down', error: (e as Error).message };
    }
  }
}
