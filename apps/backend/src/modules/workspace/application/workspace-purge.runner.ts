import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { WORKSPACE_LIFECYCLE, type WorkspaceLifecycle } from '../api/workspace-lifecycle.js';
import type { WorkspacePurgeRunner } from '../api/workspace-purge.runner.js';
import {
  BUSINESS_OBJECT_ERASER,
  type BusinessObjectEraser,
  WORKSPACE_PURGE_STORE,
  type WorkspacePurgeStore,
} from './ports/workspace-purge.js';
import { PurgeHooksFailedError, purgeErrorCode } from './purge-failure.js';

/** One scan every 5 minutes is plenty for a 30-day window; the worker ticks more often. */
export const PURGE_SCAN_MS = 5 * 60_000;
/** Businesses purged per scan; the rest wait for the next one. */
export const PURGE_PER_SCAN = 3;
/** Back-off after the first failure; doubles with every further failure. */
export const PURGE_BACKOFF_BASE_MS = 5 * 60_000;
/** The longest wait between two attempts. */
export const PURGE_BACKOFF_MAX_MS = 24 * 3_600_000;
/**
 * From this many failures on, every failure is logged at error level (someone must look), and a
 * failing deletion hook no longer holds the purge back (the rows go anyway).
 */
export const PURGE_ALERT_AFTER = 5;

/** Wait before the next attempt once `failures` runs failed: 5 min × 2^(failures − 1), ≤ 24 h. */
export function purgeBackoffMs(failures: number): number {
  const n = Math.max(1, Math.trunc(failures));
  return Math.min(PURGE_BACKOFF_MAX_MS, PURGE_BACKOFF_BASE_MS * 2 ** Math.min(n - 1, 30));
}

/**
 * Purges businesses whose 30-day restore window ended (ADR-033): claims the business (`purging`,
 * no restore after that), re-runs the deletion hooks (channels, KiotViet: idempotent, so a hook that
 * failed when the owner deleted gets another chance), then rows (catalog-derived, batched,
 * resumable), object storage, and the tombstone. A failure leaves the business `purging` with an
 * exponential back-off; the scan resumes it from where it stopped (every step is idempotent) and
 * meanwhile purges the others.
 */
@Injectable()
export class WorkspacePurgeRunnerImpl implements WorkspacePurgeRunner {
  readonly #log = new Logger('WorkspacePurge');
  #lastScan = 0;

  constructor(
    @Inject(WORKSPACE_PURGE_STORE) private readonly store: WorkspacePurgeStore,
    @Inject(BUSINESS_OBJECT_ERASER) private readonly objects: BusinessObjectEraser,
    @Inject(WORKSPACE_LIFECYCLE) private readonly lifecycle: WorkspaceLifecycle,
  ) {}

  async tick(now: Date = new Date()): Promise<number> {
    if (now.getTime() - this.#lastScan < PURGE_SCAN_MS) return 0;
    this.#lastScan = now.getTime();
    let purged = 0;
    for (const { workspaceId: ws, attempts } of await this.store.due(now, PURGE_PER_SCAN)) {
      try {
        if (await this.purge(ws, attempts)) purged += 1;
      } catch (e) {
        await this.failed(ws, attempts + 1, purgeErrorCode(e), now);
      }
    }
    return purged;
  }

  /**
   * One business; false when a restore won or the business was already purged. `attempts`: runs
   * of it that failed before this one.
   */
  async purge(ws: WorkspaceId, attempts = 0): Promise<boolean> {
    if (!(await this.store.claim(ws))) return false;
    const hooks = await this.lifecycle.afterDeletionRequested(ws);
    if (hooks.length) {
      if (attempts + 1 < PURGE_ALERT_AFTER) throw new PurgeHooksFailedError(hooks);
      this.#log.warn(
        `Business ${ws}: deletion hooks still failing in ${hooks.join(', ')}; purging`,
      );
    }
    const report = await this.store.purgeRows(ws);
    const rows = Object.values(report).reduce((sum, n) => sum + n, 0);
    let objects = 0;
    if (this.objects.available()) objects = await this.objects.erase(ws);
    else this.#log.warn(`Business ${ws}: object storage not configured, no files to delete`);
    const done = await this.store.finish(ws, rows);
    if (done) this.#log.log(`Business ${ws} purged: ${rows} rows, ${objects} files`);
    return done;
  }

  private async failed(ws: WorkspaceId, failures: number, error: string, now: Date) {
    const nextAt = new Date(now.getTime() + purgeBackoffMs(failures));
    try {
      await this.store.recordFailure(ws, { error, nextAt });
    } catch {
      // The scan retries it anyway; only the back-off is lost.
    }
    // Ids and error codes only.
    const line = `Business ${ws}: purge failed (${error}), attempt ${failures}, next after ${nextAt.toISOString()}`;
    if (failures >= PURGE_ALERT_AFTER) this.#log.error(`${line}; needs attention`);
    else this.#log.warn(line);
  }
}
