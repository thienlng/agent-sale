import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import type { FactDraft } from '../domain/fact.js';
import {
  FACT_STORE,
  type FactStore,
  PROJECTION_STORE,
  type ProjectionHealth,
  type ProjectionLease,
  type ProjectionStore,
} from '../domain/ports/projection.js';
import { mapOutboxEvent } from './fact-mapper.js';

export const BATCH_SIZE = 500;
export type { ProjectionHealth };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Projects the outbox into analytics facts. One pass takes the committed events of every
 * transaction that finished since the last pass, in pages, under an exclusive lease; idempotent (a
 * fact exists once per event and kind), so a crash before the position moves only repeats work.
 * A payload it cannot parse is dead-lettered and skipped; a database failure stops the pass and is
 * retried on the next one.
 */
@Injectable()
export class ProjectorService {
  readonly #log = new Logger(ProjectorService.name);

  constructor(
    @Inject(PROJECTION_STORE) private readonly store: ProjectionStore,
    @Inject(FACT_STORE) private readonly facts: FactStore,
  ) {}

  /** One pass. Returns how many events it consumed (0 when idle or when another projector is working). */
  async tick(): Promise<number> {
    return (await this.#pass()) ?? 0;
  }

  /** `null` when another projector holds the lease: nothing was done, and the caller may want to wait. */
  async #pass(): Promise<number | null> {
    return this.store.withLease(async (lease) => {
      let after = 0;
      let consumed = 0;
      for (;;) {
        const rows = await lease.readBatch(after, BATCH_SIZE);
        if (!rows.length) break;
        const byWorkspace = new Map<string, FactDraft[]>();
        for (const row of rows) {
          const drafts = await this.#map(lease, row);
          for (const f of drafts) {
            byWorkspace.set(f.workspaceId, [...(byWorkspace.get(f.workspaceId) ?? []), f]);
          }
        }
        for (const [ws, drafts] of byWorkspace) await this.facts.append(ws as WorkspaceId, drafts);
        consumed += rows.length;
        after = rows.reduce((max, r) => Math.max(max, r.id), after);
      }
      await lease.commit();
      return consumed;
    });
  }

  async #map(lease: ProjectionLease, row: Parameters<typeof mapOutboxEvent>[0]) {
    try {
      return mapOutboxEvent(row);
    } catch (e) {
      await lease.deadLetter(row, e instanceof Error ? e.message.slice(0, 500) : 'invalid');
      this.#log.warn(`analytics dead-lettered outbox event ${row.id} (${row.type})`);
      return [];
    }
  }

  /**
   * Reads stay fresh without a worker: project what is pending before answering. When another
   * projector (the worker, or a concurrent query) holds the lease this waits for it instead of
   * reading around it, then runs its own pass, so everything committed before the call is projected
   * when it returns. After `waitMs` it gives up and the answer carries the lag.
   */
  async catchUp(waitMs = 3000): Promise<void> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      if ((await this.#pass()) !== null) return;
      if (Date.now() >= deadline) return;
      await sleep(25);
    }
  }

  health(): Promise<ProjectionHealth> {
    return this.store.health();
  }

  /**
   * Operator rebuild of one workspace: forget its facts and replay its events, in one transaction
   * under the lease (a crash leaves the old facts; queries never see a half-built set). Only reads
   * the outbox and writes facts: nothing is sent anywhere. Unreadable events are dead-lettered.
   */
  async rebuild(ws: WorkspaceId, waitMs = 30_000): Promise<{ events: number; facts: number }> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const done = await this.store.withLease(async (lease) => {
        const drafts: FactDraft[] = [];
        let after = 0;
        let events = 0;
        for (;;) {
          const rows = await lease.readWorkspace(ws, after, BATCH_SIZE);
          if (!rows.length) break;
          for (const row of rows) drafts.push(...(await this.#map(lease, row)));
          events += rows.length;
          after = rows.reduce((max, r) => Math.max(max, r.id), after);
        }
        await lease.replaceFacts(ws, drafts);
        return { events, facts: drafts.length };
      });
      if (done) return done;
      if (Date.now() >= deadline) throw new Error('The projector is busy: try the rebuild again');
      await sleep(100);
    }
  }
}
