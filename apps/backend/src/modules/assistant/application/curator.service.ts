import type { UserId } from '@agent-sales/shared';
import { newId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { ACCOUNT_FACADE, type AccountFacade } from '../../account/api/index.js';
import {
  ASSISTANT_REPOSITORY,
  type AssistantRepository,
  type JobRecord,
  type OwnerKey,
  type SkillRecord,
  type SkillState,
} from '../domain/ports/assistant.repository.js';

const DAY_MS = 24 * 60 * 60_000;
/** An active learned skill idle (unused) longer than this becomes `stale`. */
export const CURATOR_STALE_DAYS = 30;
/** A stale learned skill idle longer than this is `archived`. */
export const CURATOR_ARCHIVE_DAYS = 90;
/** The curator runs at most once per this window per owner (ruling 1c-R4). */
export const CURATOR_INTERVAL_MS = DAY_MS;

export type CuratorOutcome = 'done' | 'failed' | 'lost';

const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);
const olderThan = (at: Date, days: number, now: Date) =>
  now.getTime() - at.getTime() > days * DAY_MS;

/**
 * The state the curator moves a learned skill to, or null to leave it (spec §10, 1c Task 4).
 * Idle = since `last_used_at`, or `created_at` when never used.
 * - Pinned skills and skills younger than 30 days are left alone.
 * - `active` idle > 30 days → `stale`, unless the owner touched it (approved, restored or edited
 *   it: `updated_at`) in the last 30 days.
 * - `stale` idle > 90 days → `archived`.
 * One step per run: an active skill goes stale first, so the owner sees it before it is archived.
 */
export function curatorStep(skill: SkillRecord, now: Date): SkillState | null {
  if (skill.provenance !== 'learned' || skill.pinned) return null;
  if (!olderThan(skill.createdAt, CURATOR_STALE_DAYS, now)) return null;
  const idleSince = skill.lastUsedAt ?? skill.createdAt;
  if (skill.state === 'active') {
    return olderThan(idleSince, CURATOR_STALE_DAYS, now) &&
      olderThan(skill.updatedAt, CURATOR_STALE_DAYS, now)
      ? 'stale'
      : null;
  }
  if (skill.state === 'stale') {
    return olderThan(idleSince, CURATOR_ARCHIVE_DAYS, now) ? 'archived' : null;
  }
  return null;
}

/**
 * The deterministic curator (no LLM call, ruling 1c-R5): the worker enqueues one `curator` job
 * per owner with learned skills at most once a day (`assistant_settings.curator_ran_at`), and
 * the job moves idle learned skills to `stale` or `archived` (`curatorStep`). Each change is a
 * ledger `archive` entry by actor `curator` (its `after.state` says stale or archived), so the
 * owner sees it in the learning feed and can undo it. Logs carry ids and counts only.
 */
@Injectable()
export class CuratorService {
  readonly #log = new Logger(CuratorService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY) private readonly repo: AssistantRepository,
    @Inject(ACCOUNT_FACADE) private readonly account: AccountFacade,
  ) {}

  /** The curator works for active owners of the account only (as the review checks). */
  async #isOwner(key: OwnerKey): Promise<boolean> {
    const accounts = await this.account.listForUser(key.ownerUserId);
    return accounts.some((a) => a.accountId === key.accountId && a.role === 'owner');
  }

  /**
   * Enqueues a curator job for every owner with active or stale learned skills whose curator
   * did not run in the last day (users who are no longer an owner of the account are skipped,
   * and get no settings row), and records the run day at once (`curator_ran_at = now`), so
   * the next tick does not enqueue it again. Returns how many were enqueued.
   */
  async schedule(now = new Date()): Promise<number> {
    const owners = await this.repo.ownersWithLearnedSkills({
      ranBefore: new Date(now.getTime() - CURATOR_INTERVAL_MS),
    });
    let enqueued = 0;
    for (const owner of owners) {
      try {
        if (!(await this.#isOwner(owner))) continue;
        await this.repo.enqueueJob(owner, {
          id: newId(),
          threadId: null,
          kind: 'curator',
          reviewScope: null,
          runAfter: now,
        });
        await this.repo.saveSettings(owner, { curatorRanAt: now });
        enqueued++;
      } catch (error) {
        this.#log.warn(`assistant curator not scheduled (${errorClass(error)})`);
      }
    }
    return enqueued;
  }

  /**
   * Runs a claimed `curator` job; a skill changed meanwhile (optimistic lock) is skipped. A user
   * who is no longer an owner of the account gets no change (the job ends `done`).
   */
  async run(job: JobRecord, now = new Date()): Promise<CuratorOutcome> {
    const key: OwnerKey = { accountId: job.accountId, ownerUserId: job.ownerUserId as UserId };
    try {
      if (!(await this.#isOwner(key))) {
        return (await this.repo.finishJob(key, job, { status: 'done' })) ? 'done' : 'lost';
      }
      let changed = 0;
      for (const skill of await this.repo.listLearnedSkillsForCurator(key)) {
        const to = curatorStep(skill, now);
        if (!to) continue;
        const updated = await this.repo.updateSkill(
          key,
          skill.id,
          { state: to },
          {
            expectedUpdatedAt: skill.updatedAt,
            event: { id: newId(), actor: 'curator', action: 'archive', runId: null },
          },
        );
        if (updated) changed++;
      }
      if (changed > 0) this.#log.log(`assistant curator job ${job.id}: ${changed} skill(s)`);
      return (await this.repo.finishJob(key, job, { status: 'done' })) ? 'done' : 'lost';
    } catch (error) {
      // No retry: the next day's run covers it.
      this.#log.warn(`assistant curator job ${job.id} failed (${errorClass(error)})`);
      const failed = await this.repo.finishJob(key, job, {
        status: 'failed',
        errorCode: 'curator_failed',
      });
      return failed ? 'failed' : 'lost';
    }
  }
}
