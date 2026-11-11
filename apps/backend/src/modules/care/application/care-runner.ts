import { Inject, Injectable, Logger } from '@nestjs/common';

import type { CareRunner } from '../api/care.runner.js';
import { CARE_LEASE_MS, CARE_MAX_ATTEMPTS, SENDING_STALE_MS } from '../domain/care.js';
import { CARE_STORE, type CareJob, type CareStore } from '../domain/ports/care.store.js';
import { CareEnroller } from './care-enroller.js';
import { CareStep } from './care-step.js';

/** Steps claimed at once; each is one model call of up to 20 s, run side by side. */
export const STEPS_PER_BATCH = 5;
/** A tick claims batch after batch while steps are due and less than this has passed. */
export const CARE_TICK_BUDGET_MS = 12_000;
const MAX_BATCHES = 50;
const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/**
 * The worker's care tick (every 15 s, like the Brain's): the outbox pass, the expiry of drafts
 * whose window closed, then the due steps claimed 5 at a time (`FOR UPDATE SKIP LOCKED`,
 * 2-minute lease), batch after batch for up to 12 s. One step's failure never stops the others;
 * a step whose worker crashed is claimed again when its lease runs out.
 */
@Injectable()
export class CareRunnerImpl implements CareRunner {
  readonly #log = new Logger(CareRunnerImpl.name);

  constructor(
    @Inject(CARE_STORE) private readonly store: CareStore,
    @Inject(CareEnroller) private readonly enroller: CareEnroller,
    @Inject(CareStep) private readonly step: CareStep,
  ) {}

  /** Wall-clock milliseconds for the tick's time budget (tests replace it). */
  clock: () => number = () => Date.now();

  async tick(now = new Date()): Promise<number> {
    try {
      await this.enroller.pass(now);
    } catch (e) {
      this.#log.warn(`care enrollment pass failed (${errorClass(e)})`);
    }
    try {
      await this.store.expireDue(now, new Date(now.getTime() - SENDING_STALE_MS));
    } catch (e) {
      this.#log.warn(`care expiry pass failed (${errorClass(e)})`);
    }
    const started = this.clock();
    let ran = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      if (batch > 0 && this.clock() - started >= CARE_TICK_BUDGET_MS) break;
      const jobs = await this.store.claimDue(now, STEPS_PER_BATCH, CARE_LEASE_MS);
      if (!jobs.length) break;
      await Promise.all(jobs.map((job) => this.#run(job, now)));
      ran += jobs.length;
    }
    return ran;
  }

  async #run(job: CareJob, now: Date): Promise<void> {
    try {
      await this.step.run(job, now);
    } catch (e) {
      // The lease runs out and the step is claimed again (its attempts were counted at claim),
      // at most a few times.
      this.#log.warn(`care step of ${job.conversationId} failed (${errorClass(e)})`);
      if (job.attempts >= CARE_MAX_ATTEMPTS) {
        await this.store.stop(job.workspaceId, job.id, 'ai_failed', now).catch(() => undefined);
      }
    }
  }
}
