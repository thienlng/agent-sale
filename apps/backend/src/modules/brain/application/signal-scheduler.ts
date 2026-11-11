import { MessageReceivedPayload } from '@agent-sales/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  BRAIN_STORE,
  type BrainStore,
  MESSAGE_EVENT_SOURCE,
  type MessageEventRow,
  type MessageEventSource,
} from '../domain/ports/brain.store.js';
import { type BrainSettings, isCustomerMessage, nextRunAfter } from '../domain/schedule.js';
import { SettingsService } from './settings.service.js';

export const SCHEDULER_BATCH = 500;
/** A message older than this when first read (a long worker outage) schedules nothing. */
export const MAX_EVENT_AGE_MS = 24 * 3_600_000;

/**
 * The outbox consumer (spec §3.2): reads `conversation.message.received.v1` the way the analytics
 * projector reads the outbox (transaction horizon, own checkpoint, exclusive lease) and upserts
 * one idle job per conversation for every customer message, `run_after = max(existing, at +
 * idle)`. Staff echoes do not schedule; bot replies are other events. Businesses in manual mode
 * schedule nothing. Idempotent: replaying an event yields the same `run_after`. A message older
 * than a day when read schedules nothing (a backlog after an outage is not evaluated in bulk).
 */
@Injectable()
export class SignalScheduler {
  readonly #log = new Logger(SignalScheduler.name);

  constructor(
    @Inject(MESSAGE_EVENT_SOURCE) private readonly events: MessageEventSource,
    @Inject(BRAIN_STORE) private readonly store: BrainStore,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** One pass; how many jobs it scheduled (0 when another worker holds the lease). */
  async pass(now = new Date()): Promise<number> {
    const done = await this.events.withLease(async (lease) => {
      const settings = new Map<string, BrainSettings>();
      let after = 0;
      let scheduled = 0;
      for (;;) {
        const rows = await lease.readBatch(after, SCHEDULER_BATCH);
        if (!rows.length) break;
        for (const row of rows) {
          if (await this.#schedule(row, settings, now)) scheduled++;
        }
        after = rows.reduce((max, r) => Math.max(max, r.id), after);
      }
      await lease.commit();
      return scheduled;
    });
    return done ?? 0;
  }

  async #schedule(
    row: MessageEventRow,
    cache: Map<string, BrainSettings>,
    now: Date,
  ): Promise<boolean> {
    const parsed = MessageReceivedPayload.safeParse(row.payload);
    if (!parsed.success) {
      this.#log.warn(`brain skipped unreadable outbox event ${row.id}`);
      return false;
    }
    if (!isCustomerMessage(parsed.data.type)) return false;
    const at = parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : row.createdAt;
    if (now.getTime() - at.getTime() > MAX_EVENT_AGE_MS) return false;
    const ws = row.workspaceId;
    let s = cache.get(ws);
    if (!s) {
      s = await this.settings.get(ws);
      cache.set(ws, s);
    }
    if (s.mode === 'manual') return false;
    await this.store.scheduleJob(ws, row.conversationId, nextRunAfter(null, at, s.idleMinutes));
    return true;
  }
}
