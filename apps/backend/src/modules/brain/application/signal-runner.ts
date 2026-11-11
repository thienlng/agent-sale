import { Inject, Injectable, Logger } from '@nestjs/common';

import type { BrainRunner } from '../api/brain.runner.js';
import { BRAIN_STORE, type BrainStore, type SignalJob } from '../domain/ports/brain.store.js';
import {
  JOB_LEASE_MS,
  JOB_RETRY_MS,
  MAX_JOB_ATTEMPTS,
  nextHcmMidnight,
} from '../domain/schedule.js';
import { SignalEvaluator } from './signal-evaluator.js';
import { SignalScheduler } from './signal-scheduler.js';

/** Jobs claimed per tick at most; each is one model call of up to 20 s, run side by side. */
export const JOBS_PER_TICK = 5;

const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/**
 * The worker's brain tick (every 15 s): schedules jobs from the outbox, puts capped jobs whose
 * day has come back to `pending`, then claims the due jobs (`FOR UPDATE SKIP LOCKED`, 2-minute
 * lease) and evaluates them. A skipped or finished job is dropped (unless a newer customer
 * message moved it meanwhile); a capped one waits for the next local day; a failed call is
 * retried later, at most 3 times. One job's failure never stops the others.
 */
@Injectable()
export class SignalRunner implements BrainRunner {
  readonly #log = new Logger(SignalRunner.name);

  constructor(
    @Inject(BRAIN_STORE) private readonly store: BrainStore,
    @Inject(SignalScheduler) private readonly scheduler: SignalScheduler,
    @Inject(SignalEvaluator) private readonly evaluator: SignalEvaluator,
  ) {}

  async tick(now = new Date()): Promise<number> {
    try {
      await this.scheduler.pass(now);
    } catch (e) {
      this.#log.warn(`brain scheduling pass failed (${errorClass(e)})`);
    }
    await this.store.resetCappedJobs(now);
    const jobs = await this.store.claimDueJobs(now, JOBS_PER_TICK, JOB_LEASE_MS);
    await Promise.all(
      jobs.map((job) =>
        this.#run(job, now).catch((e: unknown) => {
          this.#log.warn(`brain job of ${job.conversationId} not run (${errorClass(e)})`);
        }),
      ),
    );
    return jobs.length;
  }

  async #run(job: SignalJob, now: Date): Promise<void> {
    const ws = job.workspaceId;
    let result;
    try {
      result = await this.evaluator.evaluate(ws, job.conversationId, 'idle', now);
    } catch (e) {
      await this.#retryOrDrop(job, now);
      throw e;
    }
    switch (result.status) {
      case 'capped':
        await this.store.capJob(ws, job.conversationId, nextHcmMidnight(now));
        return;
      case 'failed':
        if (result.reason === 'invalid') {
          await this.store.finishJob(ws, job.conversationId, job.runAfter);
          return;
        }
        await this.#retryOrDrop(job, now);
        return;
      default:
        // ok, skipped, nothing_new, disabled: done with this message burst.
        await this.store.finishJob(ws, job.conversationId, job.runAfter);
    }
  }

  async #retryOrDrop(job: SignalJob, now: Date): Promise<void> {
    if (job.attempts >= MAX_JOB_ATTEMPTS) {
      await this.store.finishJob(job.workspaceId, job.conversationId, job.runAfter);
      return;
    }
    await this.store.retryJob(
      job.workspaceId,
      job.conversationId,
      new Date(now.getTime() + JOB_RETRY_MS),
    );
  }
}
