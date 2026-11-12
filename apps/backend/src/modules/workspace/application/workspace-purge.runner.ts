import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import type { WorkspacePurgeRunner } from '../api/workspace-purge.runner.js';
import {
  BUSINESS_OBJECT_ERASER,
  type BusinessObjectEraser,
  WORKSPACE_PURGE_STORE,
  type WorkspacePurgeStore,
} from './ports/workspace-purge.js';

/** One scan every 5 minutes is plenty for a 30-day window; the worker ticks more often. */
export const PURGE_SCAN_MS = 5 * 60_000;
/** Businesses purged per scan; the rest wait for the next one. */
export const PURGE_PER_SCAN = 3;

/**
 * Purges businesses whose 30-day restore window ended (ADR-032): rows first (catalog-derived,
 * batched, resumable), then object storage, then the tombstone. Any failure leaves the business
 * `pending_deletion` and the next scan retries from where it stopped; every step is idempotent.
 */
@Injectable()
export class WorkspacePurgeRunnerImpl implements WorkspacePurgeRunner {
  readonly #log = new Logger('WorkspacePurge');
  #lastScan = 0;

  constructor(
    @Inject(WORKSPACE_PURGE_STORE) private readonly store: WorkspacePurgeStore,
    @Inject(BUSINESS_OBJECT_ERASER) private readonly objects: BusinessObjectEraser,
  ) {}

  async tick(now: Date = new Date()): Promise<number> {
    if (now.getTime() - this.#lastScan < PURGE_SCAN_MS) return 0;
    this.#lastScan = now.getTime();
    let purged = 0;
    for (const ws of await this.store.due(now, PURGE_PER_SCAN)) {
      try {
        if (await this.purge(ws)) purged += 1;
      } catch {
        // Ids only; the next scan retries.
        this.#log.error(`Business ${ws}: purge failed, retrying on the next scan`);
      }
    }
    return purged;
  }

  /** One business; false when a restore won or the business was already purged. */
  async purge(ws: WorkspaceId): Promise<boolean> {
    if (!(await this.store.stillDue(ws))) return false;
    const report = await this.store.purgeRows(ws);
    const rows = Object.values(report).reduce((sum, n) => sum + n, 0);
    let objects = 0;
    if (this.objects.available()) objects = await this.objects.erase(ws);
    else this.#log.warn(`Business ${ws}: object storage not configured, no files to delete`);
    const done = await this.store.finish(ws, rows);
    if (done) this.#log.log(`Business ${ws} purged: ${rows} rows, ${objects} files`);
    return done;
  }
}
