import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import type { FactDraft } from '../domain/fact.js';
import {
  FACT_STORE,
  type FactStore,
  PROJECTION_STORE,
  type ProjectionStore,
} from '../domain/ports/projection.js';
import { mapOutboxEvent } from './fact-mapper.js';

export const BATCH_SIZE = 500;

export interface ProjectionHealth {
  watermarkId: number;
  watermarkAt: Date | null;
  lagSeconds: number;
}

/**
 * Projects the outbox into analytics facts. Sequential by outbox id under an
 * exclusive lease; idempotent (a fact exists once per event and kind), so a
 * crash between writing facts and moving the checkpoint only repeats work.
 * A payload it cannot parse is dead-lettered and skipped; a database failure
 * stops the batch and is retried on the next tick.
 */
@Injectable()
export class ProjectorService {
  readonly #log = new Logger(ProjectorService.name);

  constructor(
    @Inject(PROJECTION_STORE) private readonly store: ProjectionStore,
    @Inject(FACT_STORE) private readonly facts: FactStore,
  ) {}

  /** One batch. Returns how many events were consumed (0 when idle or when another projector is working). */
  async tick(limit = BATCH_SIZE): Promise<number> {
    return (await this.#project(limit)) ?? 0;
  }

  /** `null` when another projector holds the lease: nothing was done, and the caller may want to wait. */
  async #project(limit: number): Promise<number | null> {
    return this.store.withLease(async (lease) => {
      const after = await lease.checkpoint();
      const rows = await lease.readBatch(after, limit);
      if (!rows.length) return 0;
      const byWorkspace = new Map<string, FactDraft[]>();
      for (const row of rows) {
        try {
          for (const f of mapOutboxEvent(row)) {
            byWorkspace.set(f.workspaceId, [...(byWorkspace.get(f.workspaceId) ?? []), f]);
          }
        } catch (e) {
          await lease.deadLetter(row, e instanceof Error ? e.message.slice(0, 500) : 'invalid');
          this.#log.warn(`analytics dead-lettered outbox event ${row.id} (${row.type})`);
        }
      }
      for (const [ws, drafts] of byWorkspace) await this.facts.append(ws as WorkspaceId, drafts);
      await lease.commit(rows.reduce((max, r) => Math.max(max, r.id), after));
      return rows.length;
    });
  }

  /**
   * Reads stay fresh without a worker: consume what is pending (bounded) before answering. When
   * another projector (the worker, or a concurrent query) holds the lease this waits for it instead
   * of reading around it, so everything committed before the call is projected when it returns.
   * After `waitMs` it gives up and the answer carries the lag.
   */
  async catchUp(maxBatches = 10, waitMs = 3000): Promise<void> {
    const deadline = Date.now() + waitMs;
    for (let batches = 0; batches < maxBatches;) {
      const done = await this.#project(BATCH_SIZE);
      if (done === null) {
        if (Date.now() >= deadline) return;
        await new Promise((r) => setTimeout(r, 25));
        continue;
      }
      if (done < BATCH_SIZE) return;
      batches++;
    }
  }

  health(): Promise<ProjectionHealth> {
    return this.store.health();
  }

  /**
   * Operator rebuild of one workspace: forget its facts and replay its events.
   * Only reads the outbox and writes facts: nothing is sent anywhere.
   */
  async rebuild(ws: WorkspaceId): Promise<{ events: number; facts: number }> {
    await this.store.deleteFacts(ws);
    let after = 0;
    let events = 0;
    let facts = 0;
    for (;;) {
      const rows = await this.store.readWorkspace(ws, after, BATCH_SIZE);
      if (!rows.length) break;
      const drafts = rows.flatMap((row) => {
        try {
          return mapOutboxEvent(row);
        } catch {
          return [];
        }
      });
      facts += await this.facts.append(ws, drafts);
      events += rows.length;
      after = rows.reduce((max, r) => Math.max(max, r.id), after);
    }
    return { events, facts };
  }
}
