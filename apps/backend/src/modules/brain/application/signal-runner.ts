import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import type { BrainRunner } from '../api/brain.runner.js';
import { BRAIN_STORE, type BrainStore, type SignalJob } from '../domain/ports/brain.store.js';
import {
  CAPPED_RESET_DELAY_MS,
  JOB_LEASE_MS,
  JOB_RETRY_MS,
  MAX_JOB_ATTEMPTS,
  nextHcmMidnight,
} from '../domain/schedule.js';
import { Briefing } from './briefing.js';
import { SignalEvaluator } from './signal-evaluator.js';
import { SignalScheduler } from './signal-scheduler.js';

/** Jobs claimed at once; each is one model call of up to 20 s, run side by side. */
export const JOBS_PER_TICK = 5;
/**
 * A tick claims batch after batch while due jobs remain and less than this has passed (the tick
 * runs every 15 s and never overlaps itself), so a busy hour is not limited to 5 jobs a tick.
 */
export const TICK_BUDGET_MS = 12_000;
/** Batches per tick at most (a guard; the time budget normally ends the loop first). */
const MAX_BATCHES = 50;
/** The morning briefing pass runs at most this often (the tick runs every 15 s). */
export const BRIEFING_EVERY_MS = 60_000;

const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/**
 * The worker's brain tick (every 15 s): schedules jobs from the outbox, puts capped jobs whose
 * day has come back to `pending` (a few minutes later, behind the day's fresh jobs), then claims
 * the due jobs 5 at a time (`FOR UPDATE SKIP LOCKED`, 2-minute lease) and evaluates them, batch
 * after batch for up to 12 s. A skipped or finished job is dropped (unless a newer customer
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
    @Inject(Briefing) @Optional() private readonly briefing?: Briefing,
  ) {}

  #lastBriefingAt = Number.NEGATIVE_INFINITY;

  async tick(now = new Date()): Promise<number> {
    if (this.briefing && now.getTime() - this.#lastBriefingAt >= BRIEFING_EVERY_MS) {
      this.#lastBriefingAt = now.getTime();
      try {
        await this.briefing.pass(now);
      } catch (e) {
        this.#log.warn(`morning briefing pass failed (${errorClass(e)})`);
      }
    }
    try {
      await this.scheduler.pass(now);
    } catch (e) {
      this.#log.warn(`brain scheduling pass failed (${errorClass(e)})`);
    }
    await this.store.resetCappedJobs(now, new Date(now.getTime() + CAPPED_RESET_DELAY_MS));
    const started = this.clock();
    let ran = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      if (batch > 0 && this.clock() - started >= TICK_BUDGET_MS) break;
      const jobs = await this.store.claimDueJobs(now, JOBS_PER_TICK, JOB_LEASE_MS);
      if (!jobs.length) break;
      await Promise.all(
        jobs.map((job) =>
          this.#run(job, now).catch((e: unknown) => {
            this.#log.warn(`brain job of ${job.conversationId} not run (${errorClass(e)})`);
          }),
        ),
      );
      ran += jobs.length;
    }
    return ran;
  }

  /** Wall-clock milliseconds for the tick's time budget (tests replace it). */
  clock: () => number = () => Date.now();

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
