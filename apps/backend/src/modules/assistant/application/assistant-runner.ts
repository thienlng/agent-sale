import { Inject, Injectable, Logger } from '@nestjs/common';

import type { AssistantRunner } from '../api/assistant.runner.js';
import {
  ASSISTANT_REPOSITORY,
  type AssistantRepository,
  type JobRecord,
  type OwnerKey,
} from '../domain/ports/assistant.repository.js';
import { CuratorService } from './curator.service.js';
import { ReviewService } from './review.service.js';

/** Jobs claimed per tick at most. */
export const JOBS_PER_TICK = 3;
/** The lease of a claimed job: well above the review's 120 s budget. */
export const JOB_LEASE_MS = 5 * 60_000;
/** How often the tick looks for owners whose daily curator run is due (a cross-account scan). */
export const CURATOR_SCAN_MS = 10 * 60_000;

const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/**
 * The worker's assistant tick (ruling 1c-R1): at most every 10 minutes it enqueues the daily
 * curator jobs that are due (ruling 1c-R4), then claims up to 3 due jobs (`assistant_jobs`,
 * across accounts, 5-minute lease) and runs them side by side, so the last one does not wait
 * past its lease. A review job goes to `ReviewService`, a curator job to `CuratorService`; any
 * other kind is failed (`unknown_kind`). One job's failure never stops the others.
 */
@Injectable()
export class AssistantJobRunner implements AssistantRunner {
  readonly #log = new Logger(AssistantJobRunner.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY) private readonly repo: AssistantRepository,
    @Inject(ReviewService) private readonly review: ReviewService,
    @Inject(CuratorService) private readonly curator: CuratorService,
  ) {}

  /** When the curator scan last ran in this process; null = not yet. */
  #curatorScannedAt: number | null = null;

  async tick(now = new Date()): Promise<void> {
    await this.#scheduleCurator(now);
    const jobs = await this.repo.claimJobs(now, JOBS_PER_TICK, JOB_LEASE_MS);
    await Promise.all(
      jobs.map((job) =>
        this.#run(job).catch((error: unknown) => {
          this.#log.warn(`assistant job ${job.id} not run (${errorClass(error)})`);
        }),
      ),
    );
  }

  async #scheduleCurator(now: Date): Promise<void> {
    const last = this.#curatorScannedAt;
    if (last !== null && now.getTime() - last < CURATOR_SCAN_MS) return;
    this.#curatorScannedAt = now.getTime();
    try {
      await this.curator.schedule(now);
    } catch (error) {
      this.#log.warn(`assistant curator scan failed (${errorClass(error)})`);
    }
  }

  async #run(job: JobRecord): Promise<void> {
    if (job.kind === 'review') {
      await this.review.run(job);
      return;
    }
    if (job.kind === 'curator') {
      await this.curator.run(job);
      return;
    }
    const key: OwnerKey = {
      accountId: job.accountId,
      ownerUserId: job.ownerUserId as OwnerKey['ownerUserId'],
    };
    await this.repo.finishJob(key, job, { status: 'failed', errorCode: 'unknown_kind' });
  }
}
