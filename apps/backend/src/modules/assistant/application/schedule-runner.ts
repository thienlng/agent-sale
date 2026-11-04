import { newId, type UserId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { ACCOUNT_FACADE, type AccountFacade } from '../../account/api/index.js';
import { AI_LLM_GATEWAY, type LlmGatewayPort } from '../../ai/api/index.js';
import {
  NOTIFICATION_FACADE,
  type NotificationFacade,
  type NotificationTarget,
  type NotifyInput,
} from '../../notification/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { AssistantScheduleRunner } from '../api/assistant.runner.js';
import { decideAlert } from '../domain/alert-decision.js';
import { isMissed } from '../domain/cadence.js';
import {
  ASSISTANT_REPOSITORY,
  type AssistantRepository,
  type ScheduleRecord,
  type ScheduleRunRecord,
  type ScheduleStatePatch,
} from '../domain/ports/assistant.repository.js';
import { fill } from '../domain/report-render.js';
import type {
  ScheduleChannel,
  ScheduleClaimOutcome,
  SchedulePausedReason,
  ScheduleTemplate,
} from '../domain/schedule.js';
import { type ComputedReport, ReportService } from './report.service.js';
import { writeCommentary } from './schedule-commentary.js';

/** Schedules claimed per pass (spec §11). */
export const SCHEDULE_BATCH = 10;
/** A claimed schedule is leased this long; a crashed worker's lease lapses after it. */
export const SCHEDULE_LEASE_MS = 5 * 60_000;
/** Consecutive execution failures that pause a schedule (S3-R14). */
export const MAX_SCHEDULE_FAILURES = 3;
/** Runs are kept this long (spec §4). */
export const SCHEDULE_RUN_RETENTION_DAYS = 90;
/** Where an alert's notification leads (spec §6). */
export const ALERT_PATHS: Partial<Record<ScheduleTemplate, string>> = {
  new_orders: '/app/orders',
  low_stock: '/app/products',
  unanswered_conversations: '/app/inbox',
  new_requests: '/app/contacts',
};

const DAY_MS = 86_400_000;
const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

type PreflightBlock = Extract<SchedulePausedReason, 'owner_not_active' | 'business_unavailable'>;

/** The `notify` dedup key of a slot: a retried slot never notifies twice. */
export const scheduleDedupKey = (scheduleId: string, scheduledFor: Date, suffix = '') =>
  `sched:${scheduleId}:${scheduledFor.toISOString()}${suffix}`;

/**
 * Runs the due report and alert schedules (T-172, spec §6) on the `app_system` connection:
 * claim with a lease, take the slot (a unique run per slot), preflight the owner and the business
 * (no data read, no model call before it passes), compute the report in code, add the optional
 * commentary, render it in the owner's language and deliver it through `notification`. Alerts
 * fire on change only (S3-R13). Logs carry ids and error classes only.
 */
/**
 * A run row's own timestamps: the wall clock, never before the tick's `now`. The tick's `now`
 * is taken before the run row exists, so writing it as `finished_at` put the finish before the
 * row's `started_at` (QA M-6); both are now read from this clock, in order.
 */
function runClock(now: Date): Date {
  return new Date(Math.max(Date.now(), now.getTime()));
}

@Injectable()
export class ScheduleRunner implements AssistantScheduleRunner {
  readonly #log = new Logger('AssistantScheduleRunner');
  #purgedDay: string | null = null;

  constructor(
    @Inject(ASSISTANT_REPOSITORY) private readonly repo: AssistantRepository,
    @Inject(ACCOUNT_FACADE) private readonly account: AccountFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspace: WorkspaceFacade,
    @Inject(NOTIFICATION_FACADE) private readonly notifications: NotificationFacade,
    @Inject(ReportService) private readonly reports: ReportService,
    @Inject(AI_LLM_GATEWAY) private readonly gateway: LlmGatewayPort,
  ) {}

  async tick(now = new Date()): Promise<number> {
    await this.#purgeDaily(now);
    const claimed = await this.repo.claimDueSchedules(now, SCHEDULE_BATCH, SCHEDULE_LEASE_MS);
    for (const s of claimed) {
      try {
        await this.#runOne(s, now);
      } catch (e) {
        this.#log.error(`schedule ${s.id}: run failed (${errorClass(e)})`);
      }
    }
    return claimed.length;
  }

  async #runOne(s: ScheduleRecord, now: Date): Promise<void> {
    const manual = s.runRequestedAt !== null;
    const scheduledFor = s.runRequestedAt ?? s.nextRunAt ?? now;
    const state: ScheduleStatePatch = {};
    // Whatever happens below, the slot is taken: a cadence run moves the next one after now
    // (S3-R15). A manual run leaves `next_run_at` alone, so a cadence slot due at the same time
    // runs on the next tick instead of being dropped.
    const claim: ScheduleClaimOutcome = {
      runRequestedAt: s.runRequestedAt,
      advanceFrom: manual ? null : now,
    };
    try {
      if (!manual && isMissed(scheduledFor, now)) {
        await this.repo.insertScheduleRun({
          ...this.#runKey(s, scheduledFor, 'cadence', now),
          status: 'skipped',
          errorCode: 'missed',
          finishedAt: runClock(now),
        });
        return;
      }
      // Reports and manual runs take the slot up front; an alert only once it fires (S3-R13).
      let run: ScheduleRunRecord | null = null;
      if (s.mode === 'report' || manual) {
        run = await this.#takeSlot(s, scheduledFor, manual, now);
        if (!run) return;
      }

      const blocked = await this.#preflight(s);
      if (blocked) {
        await this.#block(s, run, scheduledFor, manual, blocked, now, claim);
        return;
      }

      await this.#execute(s, run, scheduledFor, manual, now, state, claim);
    } finally {
      // Always releases the lease; applied to the row as stored now (owner edits win).
      await this.repo.saveScheduleState(s.id, state, claim);
    }
  }

  #runKey(s: ScheduleRecord, scheduledFor: Date, trigger: 'cadence' | 'manual', now: Date) {
    return {
      id: newId(),
      accountId: s.accountId,
      ownerUserId: s.ownerUserId,
      scheduleId: s.id,
      trigger,
      scheduledFor,
      startedAt: runClock(now),
    };
  }

  /**
   * The slot's run: a new `running` one, or the `running` one a crashed worker left (its
   * notification then dedups). Null when another worker already finished the slot.
   */
  async #takeSlot(
    s: ScheduleRecord,
    scheduledFor: Date,
    manual: boolean,
    now: Date,
  ): Promise<ScheduleRunRecord | null> {
    const run = await this.repo.insertScheduleRun(
      this.#runKey(s, scheduledFor, manual ? 'manual' : 'cadence', now),
    );
    if (run) return run;
    const existing = await this.repo.getScheduleRunAt(s.id, scheduledFor);
    return existing?.status === 'running' ? existing : null;
  }

  /** No model call and no data read (spec §6 step 3); null when the schedule may run. */
  async #preflight(s: ScheduleRecord): Promise<PreflightBlock | null> {
    const owner = s.ownerUserId as UserId;
    const business = s.businessId as WorkspaceId;
    const accounts = await this.account.listForUser(owner);
    if (!accounts.some((a) => a.accountId === s.accountId && a.role === 'owner')) {
      return 'owner_not_active';
    }
    if ((await this.workspace.accountOf(business)) !== s.accountId) return 'business_unavailable';
    if (!(await this.workspace.findMembership(business, owner))) return 'business_unavailable';
    return null;
  }

  /** A preflight block pauses at once; only a business problem is told to the owner (S3-R14). */
  async #block(
    s: ScheduleRecord,
    run: ScheduleRunRecord | null,
    scheduledFor: Date,
    manual: boolean,
    reason: PreflightBlock,
    now: Date,
    claim: ScheduleClaimOutcome,
  ): Promise<void> {
    if (run) {
      await this.repo.finishScheduleRun(run.id, {
        status: 'blocked',
        errorCode: reason,
        finishedAt: runClock(now),
      });
    } else {
      await this.repo.insertScheduleRun({
        ...this.#runKey(s, scheduledFor, manual ? 'manual' : 'cadence', now),
        status: 'blocked',
        errorCode: reason,
        finishedAt: runClock(now),
      });
    }
    claim.pause = reason;
    if (reason === 'owner_not_active') return;
    await this.#notifyPaused(s, reason, ['in_app'], scheduledFor, null);
  }

  async #execute(
    s: ScheduleRecord,
    taken: ScheduleRunRecord | null,
    scheduledFor: Date,
    manual: boolean,
    now: Date,
    state: ScheduleStatePatch,
    claim: ScheduleClaimOutcome,
  ): Promise<void> {
    let run = taken;
    try {
      // A cadence report covers the period of its slot, even when it runs late (S3-R15).
      const periodAt = s.mode === 'report' && !manual ? scheduledFor : now;
      const computed = await this.reports.compute(
        {
          businessId: s.businessId,
          template: s.template,
          mode: s.mode,
          params: s.params,
          alertCursor: s.alertCursor,
        },
        now,
        periodAt,
      );
      // The alert state is kept only once the alert is delivered, so a failed delivery neither
      // loses new orders behind a moved cursor nor silences a changed set.
      const alert: ScheduleStatePatch = {};
      if (s.mode === 'alert') {
        const fire = this.#alertState(s, computed, now, alert);
        // A quiet check leaves no run row (S3-R13) but is a success (S3-R14); a manual run
        // always reports.
        if (!fire && !manual) {
          Object.assign(state, alert, { consecutiveFailures: 0 });
          return;
        }
      }
      run ??= await this.#takeSlot(s, scheduledFor, manual, now);
      if (!run) return;
      await this.#deliver(s, run, computed, scheduledFor, now);
      Object.assign(state, alert, { lastRunAt: now, consecutiveFailures: 0 });
    } catch (e) {
      if (s.mode === 'alert') state.lastCheckedAt = now;
      this.#log.warn(`schedule ${s.id}: compute failed (${errorClass(e)})`);
      await this.#fail(s, run, scheduledFor, manual, now, state, claim);
    }
  }

  /**
   * Updates the alert state of a check and says whether it fires: `new_orders` and `new_requests` move their cursor
   * when it fires; the others fire on a changed fingerprint or a 24 h old one.
   */
  #alertState(
    s: ScheduleRecord,
    computed: ComputedReport,
    now: Date,
    state: ScheduleStatePatch,
  ): boolean {
    state.lastCheckedAt = now;
    if (s.template === 'new_orders' || s.template === 'new_requests') {
      if (computed.hit) Object.assign(state, { alertCursor: now, lastAlertedAt: now });
      return computed.hit;
    }
    if (!computed.hit) {
      state.alertFingerprint = null;
      return false;
    }
    const d = decideAlert({
      hitIds: computed.hitIds,
      lastFingerprint: s.alertFingerprint,
      lastAlertedAt: s.lastAlertedAt,
      now,
    });
    if (d.fire) Object.assign(state, { alertFingerprint: d.fingerprint, lastAlertedAt: now });
    return d.fire;
  }

  async #deliver(
    s: ScheduleRecord,
    run: ScheduleRunRecord,
    computed: ComputedReport,
    scheduledFor: Date,
    now: Date,
  ): Promise<void> {
    const [locale, business] = await Promise.all([
      this.notifications.recipientLocale(s.ownerUserId),
      this.workspace.getById(s.businessId as WorkspaceId),
    ]);
    const rendered = this.reports.render(computed.result, locale, business.name);
    const channels = this.#channels(s.channels);
    const notes: string[] = [];
    let commentaryRunId: string | null = null;
    if (s.commentary) {
      const c = await writeCommentary(
        { repo: this.repo, gateway: this.gateway, log: this.#log },
        s,
        computed,
      );
      commentaryRunId = c.runId;
      if (c.text) notes.push(`${this.reports.text(locale, 'commentary')} ${c.text}`);
    }
    if (channels.length < s.channels.length)
      notes.push(this.reports.text(locale, 'emailUnavailable'));
    const body = [rendered.body, ...notes].join('\n\n').slice(0, 4000);
    const target: NotificationTarget =
      s.mode === 'report'
        ? { kind: 'assistant_report', runId: run.id }
        : { kind: 'path', path: ALERT_PATHS[s.template] ?? '/app' };
    const { id } = await this.notifications.notify({
      accountId: s.accountId,
      userId: s.ownerUserId,
      workspaceId: s.businessId,
      type: s.mode === 'report' ? 'assistant.report' : 'assistant.alert',
      params: { scheduleId: s.id, runId: run.id, template: s.template },
      title: rendered.title,
      body,
      target,
      channels,
      dedupKey: scheduleDedupKey(s.id, scheduledFor),
    });
    await this.repo.finishScheduleRun(run.id, {
      status: 'done',
      report: computed.result as unknown as Record<string, unknown>,
      title: rendered.title,
      body,
      commentaryRunId,
      notificationId: id,
      finishedAt: runClock(now),
    });
  }

  /** Email is dropped for this run when the channel is off (spec §6 step 3); never a block. */
  #channels(channels: ScheduleChannel[]): NotifyInput['channels'] {
    const email = this.notifications.emailAvailable();
    return channels.filter((c) => c !== 'email' || email);
  }

  async #fail(
    s: ScheduleRecord,
    run: ScheduleRunRecord | null,
    scheduledFor: Date,
    manual: boolean,
    now: Date,
    state: ScheduleStatePatch,
    claim: ScheduleClaimOutcome,
  ): Promise<void> {
    const failed = { status: 'failed' as const, errorCode: 'compute_failed' };
    if (run) await this.repo.finishScheduleRun(run.id, { ...failed, finishedAt: runClock(now) });
    else {
      await this.repo.insertScheduleRun({
        ...this.#runKey(s, scheduledFor, manual ? 'manual' : 'cadence', now),
        ...failed,
        finishedAt: runClock(now),
      });
    }
    const failures = s.consecutiveFailures + 1;
    state.consecutiveFailures = failures;
    if (failures < MAX_SCHEDULE_FAILURES) return;
    claim.pause = 'failures';
    await this.#notifyPaused(s, 'failures', this.#channels(s.channels), scheduledFor, s.businessId);
  }

  async #notifyPaused(
    s: ScheduleRecord,
    reason: 'failures' | 'business_unavailable',
    channels: NotifyInput['channels'],
    scheduledFor: Date,
    workspaceId: string | null,
  ): Promise<void> {
    try {
      const locale = await this.notifications.recipientLocale(s.ownerUserId);
      const strings = (key: string) => this.reports.text(locale, key);
      await this.notifications.notify({
        accountId: s.accountId,
        userId: s.ownerUserId,
        workspaceId,
        type: 'assistant.schedule_paused',
        params: { scheduleId: s.id, reason },
        title: fill({ t: strings('paused.title') }, 't', { name: s.name }).slice(0, 160),
        body: strings(`paused.${reason}`),
        target: { kind: 'path', path: '/app' },
        channels,
        dedupKey: scheduleDedupKey(s.id, scheduledFor, ':paused'),
      });
    } catch (e) {
      this.#log.warn(`schedule ${s.id}: pause notice not sent (${errorClass(e)})`);
    }
  }

  /** Once a day: runs older than 90 days go (spec §4). */
  async #purgeDaily(now: Date): Promise<void> {
    const day = now.toISOString().slice(0, 10);
    if (this.#purgedDay === day) return;
    this.#purgedDay = day;
    try {
      await this.repo.purgeOldScheduleRuns(
        new Date(now.getTime() - SCHEDULE_RUN_RETENTION_DAYS * DAY_MS),
      );
    } catch (e) {
      this.#log.error(`schedule run purge failed (${errorClass(e)})`);
    }
  }
}
