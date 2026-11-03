import { scanUntrustedText } from '@agent-sales/ai-core';
import {
  type AssistantThreadDto,
  ScheduleDraft,
  type ScheduleDto,
  type ScheduleList,
  scheduleParamsSchema,
  type SchedulePatch as SchedulePatchRequest,
  type SchedulePreview,
  type ScheduleRunList,
} from '@agent-sales/contracts';
import { isUuid, newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { ACCOUNT_FACADE, type AccountFacade } from '../../account/api/index.js';
import { NOTIFICATION_FACADE, type NotificationFacade } from '../../notification/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { AssistantActor } from '../api/assistant.facade.js';
import {
  AssistantNotFoundError,
  AssistantScheduleConflictError,
  AssistantScheduleInvalidError,
} from '../domain/assistant.errors.js';
import { nextRunAt, nextRuns } from '../domain/cadence.js';
import {
  ASSISTANT_REPOSITORY,
  type AssistantRepository,
  type ScheduleRecord,
  type SchedulePatch,
  SCHEDULE_RUN_LIST_LIMIT,
} from '../domain/ports/assistant.repository.js';
import {
  changesAlertState,
  MANUAL_RUN_GAP_MS,
  MAX_SCHEDULES,
  type ScheduleCreatedBy,
  type ScheduleDraftInput,
  type ScheduleProblem,
  validateDraft,
} from '../domain/schedule.js';
import { toThreadDto } from './mappers.js';
import { type OwnerScope, resolveOwnerScope } from './owner-access.js';
import { ASSISTANT_PROMPT } from './prompt-builder.js';
import { ReportService } from './report.service.js';
import { type Delivery, toScheduleDto, toScheduleRunDto } from './schedule-mappers.js';
import { ThreadPromptService } from './thread-prompt.service.js';

/** The params of a template in a mode, defaults filled; `invalid_params` when they do not fit. */
function normaliseParams(d: Pick<ScheduleDraftInput, 'template' | 'mode' | 'params'>) {
  const parsed = scheduleParamsSchema(d.template, d.mode).safeParse(d.params);
  if (!parsed.success) throw new AssistantScheduleInvalidError(['invalid_params']);
  return parsed.data as Record<string, unknown>;
}

/** The stored `body` of a `schedule` proposal (S3-R11). */
export type ScheduleProposalBody =
  | { op: 'create'; draft: ScheduleDraft }
  | { op: 'edit'; scheduleId: string; patch: SchedulePatchRequest }
  | { op: 'remove'; scheduleId: string };

/** The result of applying a schedule proposal: the schedule, or the code it failed with. */
export type ScheduleApplyOutcome =
  { ok: true; id: string; name: string } | { ok: false; errorCode: string };

/** Accepting a 1c `schedule` suggestion (S3-R12). */
export type ScheduleSuggestionOutcome =
  | { ok: true; scheduleDraft: ScheduleDraft }
  | { ok: false; errorCode: 'invalid_schedule_draft' | 'unknown_suggestion' };

/** A schedule as the assistant's `schedule` tool lists it. */
export interface ScheduleToolItem {
  id: string;
  name: string;
  business: string;
  template: string;
  mode: string;
  cadence: unknown;
  channels: string[];
  status: string;
  pausedReason: string | null;
  nextRunAt: string | null;
  lastRun: { status: string; finishedAt: string | null } | null;
}

/** The code a schedule action failed with, for the tool and proposals; other errors rethrow. */
export function scheduleErrorCode(e: unknown): string {
  if (e instanceof AssistantScheduleInvalidError) {
    return String((e.details as { reason?: unknown } | undefined)?.reason ?? 'invalid_draft');
  }
  if (e instanceof AssistantScheduleConflictError) {
    return String((e.details as { reason?: unknown } | undefined)?.reason ?? 'conflict');
  }
  if (e instanceof AssistantNotFoundError) return 'unknown_schedule';
  throw e;
}

const isNewOrdersAlert = (d: Pick<ScheduleDraftInput, 'template' | 'mode'>) =>
  d.template === 'new_orders' && d.mode === 'alert';

/**
 * The owner's report and alert schedules (T-172): owner actions apply directly; the assistant's
 * create/edit/remove go through proposals that call `createFor`/`updateFor`/`removeFor`. Every
 * method resolves the owner scope first (403 for staff, 404 for another owner's rows).
 */
@Injectable()
export class SchedulesService {
  constructor(
    @Inject(ACCOUNT_FACADE) private readonly account: AccountFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspace: WorkspaceFacade,
    @Inject(ASSISTANT_REPOSITORY) private readonly repo: AssistantRepository,
    @Inject(NOTIFICATION_FACADE) private readonly notifications: NotificationFacade,
    @Inject(ReportService) private readonly reports: ReportService,
    @Inject(ThreadPromptService) private readonly prompts: ThreadPromptService,
  ) {}

  scope(actor: AssistantActor): Promise<OwnerScope> {
    return resolveOwnerScope(
      { account: this.account, workspace: this.workspace },
      actor.userId,
      actor.businessId,
    );
  }

  async #own(scope: OwnerScope, id: string): Promise<ScheduleRecord> {
    const s = isUuid(id) ? await this.repo.getSchedule(scope, id) : null;
    if (!s) throw new AssistantNotFoundError('schedule', id);
    return s;
  }

  /** Schedules plus pending schedule proposals: what the limit counts. */
  async used(scope: OwnerScope, now = new Date()): Promise<number> {
    const [schedules, pending] = await Promise.all([
      this.repo.countSchedules(scope),
      this.repo.countPendingScheduleProposals(scope, now),
    ]);
    return schedules + pending;
  }

  /** Validates a whole draft; throws 400 with every problem. */
  #validate(
    scope: OwnerScope,
    d: ScheduleDraftInput,
    existingCount: number | null,
    opts: { email?: boolean } = {},
  ): void {
    const problems: ScheduleProblem[] = validateDraft(d, {
      businessIds: scope.businessIds,
      existingCount,
      emailAvailable: opts.email ?? this.notifications.emailAvailable(),
      isSafeText: (text) => scanUntrustedText(text).ok,
    });
    if (problems.length) throw new AssistantScheduleInvalidError(problems);
  }

  async #deliveries(
    scope: OwnerScope,
    notificationIds: (string | null)[],
  ): Promise<Map<string, Delivery>> {
    const ids = notificationIds.filter((x): x is string => x !== null);
    if (ids.length === 0) return new Map();
    return this.notifications.deliverySummary(scope.accountId, scope.ownerUserId, ids);
  }

  /**
   * The problems of a draft (`invalid_params` included) with its params normalised; the limit
   * counts `existingCount` (null skips it). For the tool, before a proposal is made.
   */
  check(
    scope: OwnerScope,
    draft: ScheduleDraftInput,
    existingCount: number | null,
    opts: { email?: boolean } = {},
  ): { draft: ScheduleDraftInput; problems: (ScheduleProblem | 'invalid_params')[] } {
    const d: ScheduleDraftInput = { ...draft, name: draft.name.trim() };
    const parsed = scheduleParamsSchema(d.template, d.mode).safeParse(d.params);
    if (!parsed.success) return { draft: d, problems: ['invalid_params'] };
    d.params = parsed.data as Record<string, unknown>;
    const problems = validateDraft(d, {
      businessIds: scope.businessIds,
      existingCount,
      emailAvailable: opts.email ?? this.notifications.emailAvailable(),
      isSafeText: (text) => scanUntrustedText(text).ok,
    });
    return { draft: d, problems };
  }

  /**
   * An edit merged onto the owner's schedule (404 when not theirs). Email already on the
   * schedule stays allowed while email is off; only adding it needs the channel.
   */
  async merge(
    scope: OwnerScope,
    id: string,
    patch: SchedulePatchRequest,
  ): Promise<{ current: ScheduleRecord; merged: ScheduleDraftInput; email: boolean | undefined }> {
    const current = await this.#own(scope, id);
    const merged: ScheduleDraftInput = {
      name: (patch.name ?? current.name).trim(),
      businessId: patch.businessId ?? current.businessId,
      template: patch.template ?? current.template,
      mode: patch.mode ?? current.mode,
      params: patch.params ?? current.params,
      cadence: patch.cadence ?? current.cadence,
      channels: [...new Set(patch.channels ?? current.channels)],
      commentary: patch.commentary ?? current.commentary,
    };
    const addsEmail = merged.channels.includes('email') && !current.channels.includes('email');
    return { current, merged, email: addsEmail ? undefined : true };
  }

  /** The owner's schedule, or null (the tool's `unknown_schedule`). */
  find(scope: OwnerScope, id: string): Promise<ScheduleRecord | null> {
    return isUuid(id) ? this.repo.getSchedule(scope, id) : Promise.resolve(null);
  }

  /** At most 10 schedules as the `schedule` tool lists them, with the business name. */
  async toolList(scope: OwnerScope): Promise<ScheduleToolItem[]> {
    const schedules = (await this.repo.listSchedules(scope)).slice(0, MAX_SCHEDULES);
    const names = new Map<string, string>();
    await Promise.all(
      [...new Set(schedules.map((s) => s.businessId))].map(async (b) => {
        const w = await this.workspace.getById(b as WorkspaceId).catch(() => null);
        names.set(b, w?.name ?? b);
      }),
    );
    return Promise.all(
      schedules.map(async (s) => {
        const [last] = await this.repo.listScheduleRuns(scope, s.id, 1);
        return {
          id: s.id,
          name: s.name,
          business: names.get(s.businessId) ?? s.businessId,
          template: s.template,
          mode: s.mode,
          cadence: s.cadence,
          channels: s.channels,
          status: s.status,
          pausedReason: s.pausedReason,
          nextRunAt: s.nextRunAt?.toISOString() ?? null,
          lastRun: last
            ? { status: last.status, finishedAt: last.finishedAt?.toISOString() ?? null }
            : null,
        };
      }),
    );
  }

  async #dto(scope: OwnerScope, s: ScheduleRecord): Promise<ScheduleDto> {
    const [last] = await this.repo.listScheduleRuns(scope, s.id, 1);
    const delivery = await this.#deliveries(scope, [last?.notificationId ?? null]);
    return toScheduleDto(s, last ?? null, delivery.get(last?.notificationId ?? '') ?? {});
  }

  async list(actor: AssistantActor): Promise<ScheduleList> {
    const scope = await this.scope(actor);
    const schedules = await this.repo.listSchedules(scope);
    const lastRuns = await Promise.all(
      schedules.map(async (s) => (await this.repo.listScheduleRuns(scope, s.id, 1))[0] ?? null),
    );
    const delivery = await this.#deliveries(
      scope,
      lastRuns.map((r) => r?.notificationId ?? null),
    );
    return {
      items: schedules.map((s, i) => {
        const last = lastRuns[i] ?? null;
        return toScheduleDto(s, last, delivery.get(last?.notificationId ?? '') ?? {});
      }),
      limit: MAX_SCHEDULES,
      used: await this.used(scope),
      emailAvailable: this.notifications.emailAvailable(),
    };
  }

  async create(actor: AssistantActor, draft: ScheduleDraft): Promise<ScheduleDto> {
    const scope = await this.scope(actor);
    return this.#dto(scope, await this.createFor(scope, draft, 'owner'));
  }

  /** Creates a schedule in the owner's scope (also used when a proposal or suggestion applies). */
  async createFor(
    scope: OwnerScope,
    draft: ScheduleDraft,
    createdBy: ScheduleCreatedBy,
    now = new Date(),
  ): Promise<ScheduleRecord> {
    const d: ScheduleDraftInput = { ...draft, name: draft.name.trim() };
    d.params = normaliseParams(d);
    this.#validate(scope, d, await this.used(scope, now));
    return this.repo.createSchedule(scope, {
      id: newId(),
      businessId: d.businessId,
      name: d.name,
      template: d.template,
      mode: d.mode,
      params: d.params,
      cadence: d.cadence,
      channels: [...new Set(d.channels)],
      commentary: d.commentary,
      createdBy,
      nextRunAt: nextRunAt(d.cadence, now),
      alertCursor: isNewOrdersAlert(d) ? now : null,
    });
  }

  async update(
    actor: AssistantActor,
    id: string,
    patch: SchedulePatchRequest,
  ): Promise<ScheduleDto> {
    const scope = await this.scope(actor);
    return this.#dto(scope, await this.updateFor(scope, id, patch));
  }

  /**
   * Applies an edit: re-validates the merged draft, recomputes `next_run_at` while active, and
   * resets the alert state when the template, mode or params change.
   */
  async updateFor(
    scope: OwnerScope,
    id: string,
    patch: SchedulePatchRequest,
    now = new Date(),
  ): Promise<ScheduleRecord> {
    const { current, merged, email } = await this.merge(scope, id, patch);
    merged.params = normaliseParams(merged);
    this.#validate(scope, merged, null, email === undefined ? {} : { email });
    const changes: SchedulePatch = { ...merged };
    if (current.status === 'active') changes.nextRunAt = nextRunAt(merged.cadence, now);
    if (changesAlertState(current, merged)) {
      changes.alertFingerprint = null;
      changes.lastAlertedAt = null;
      changes.alertCursor = now;
    }
    const expected = patch.expectedUpdatedAt ? new Date(patch.expectedUpdatedAt) : undefined;
    const updated = await this.repo.updateSchedule(scope, id, changes, expected);
    if (!updated) throw new AssistantScheduleConflictError('stale_schedule');
    return updated;
  }

  async pause(actor: AssistantActor, id: string): Promise<ScheduleDto> {
    return this.pauseFor(await this.scope(actor), id);
  }

  async pauseFor(scope: OwnerScope, id: string): Promise<ScheduleDto> {
    await this.#own(scope, id);
    const s = await this.repo.updateSchedule(scope, id, {
      status: 'paused',
      pausedReason: 'owner',
      nextRunAt: null,
      runRequestedAt: null,
    });
    if (!s) throw new AssistantNotFoundError('schedule', id);
    return this.#dto(scope, s);
  }

  async resume(actor: AssistantActor, id: string, now = new Date()): Promise<ScheduleDto> {
    return this.resumeFor(await this.scope(actor), id, now);
  }

  async resumeFor(scope: OwnerScope, id: string, now = new Date()): Promise<ScheduleDto> {
    const current = await this.#own(scope, id);
    const s = await this.repo.updateSchedule(scope, id, {
      status: 'active',
      pausedReason: null,
      consecutiveFailures: 0,
      nextRunAt: nextRunAt(current.cadence, now),
      // A new-orders alert does not report what came in while it was paused.
      ...(isNewOrdersAlert(current) ? { alertCursor: now } : {}),
    });
    if (!s) throw new AssistantNotFoundError('schedule', id);
    return this.#dto(scope, s);
  }

  /** "Chạy ngay": 409 `run_too_soon` within 5 minutes of the last manual run (or one pending). */
  async requestRun(actor: AssistantActor, id: string, now = new Date()): Promise<ScheduleDto> {
    return this.requestRunFor(await this.scope(actor), id, now);
  }

  async requestRunFor(scope: OwnerScope, id: string, now = new Date()): Promise<ScheduleDto> {
    const current = await this.#own(scope, id);
    if (current.status !== 'active') throw new AssistantScheduleConflictError('schedule_paused');
    if (current.runRequestedAt) throw new AssistantScheduleConflictError('run_too_soon');
    const runs = await this.repo.listScheduleRuns(scope, id, SCHEDULE_RUN_LIST_LIMIT);
    const lastManual = runs.find((r) => r.trigger === 'manual');
    if (lastManual && now.getTime() - lastManual.startedAt.getTime() < MANUAL_RUN_GAP_MS) {
      throw new AssistantScheduleConflictError('run_too_soon');
    }
    const s = await this.repo.updateSchedule(scope, id, { runRequestedAt: now });
    if (!s) throw new AssistantNotFoundError('schedule', id);
    return this.#dto(scope, s);
  }

  async remove(actor: AssistantActor, id: string): Promise<void> {
    const scope = await this.scope(actor);
    await this.removeFor(scope, id);
  }

  async removeFor(scope: OwnerScope, id: string): Promise<void> {
    if (!isUuid(id) || !(await this.repo.deleteSchedule(scope, id))) {
      throw new AssistantNotFoundError('schedule', id);
    }
  }

  /**
   * Applies an approved `schedule` proposal in-process (S3-R11): re-validates against the
   * current limit, business scope and email availability, then creates (`created_by
   * 'assistant'`), updates or removes.
   */
  async applyProposal(
    scope: OwnerScope,
    body: ScheduleProposalBody,
    now = new Date(),
  ): Promise<ScheduleApplyOutcome> {
    try {
      switch (body.op) {
        case 'create': {
          const draft = ScheduleDraft.safeParse(body.draft);
          if (!draft.success) return { ok: false, errorCode: 'invalid_params' };
          const s = await this.createFor(scope, draft.data, 'assistant', now);
          return { ok: true, id: s.id, name: s.name };
        }
        case 'edit': {
          const s = await this.updateFor(scope, body.scheduleId, body.patch, now);
          return { ok: true, id: s.id, name: s.name };
        }
        case 'remove': {
          const current = await this.#own(scope, body.scheduleId);
          await this.removeFor(scope, body.scheduleId);
          return { ok: true, id: current.id, name: current.name };
        }
        default:
          return { ok: false, errorCode: 'invalid_proposal' };
      }
    } catch (e) {
      return { ok: false, errorCode: scheduleErrorCode(e) };
    }
  }

  /**
   * Accepting a 1c `schedule` suggestion (S3-R12): its payload must be a `ScheduleDraft`
   * (`businessId` defaults to the current business). Valid → `accepted` with the draft, which the
   * web opens in the editor (saving it is the approval); invalid → `dismissed`, answered as 422
   * `invalid_schedule_draft` by the suggestions route.
   */
  async acceptSuggestion(
    scope: OwnerScope,
    suggestionId: string,
    now = new Date(),
  ): Promise<ScheduleSuggestionOutcome> {
    const suggestion = isUuid(suggestionId)
      ? (await this.repo.listSuggestions(scope, { status: 'pending' })).find(
          (x) => x.id === suggestionId && x.kind === 'schedule',
        )
      : undefined;
    if (!suggestion) return { ok: false, errorCode: 'unknown_suggestion' };
    const draft = ScheduleDraft.safeParse({
      businessId: scope.businessId,
      ...suggestion.payload,
    });
    const valid = draft.success && scope.businessIds.some((b) => b === draft.data.businessId);
    const decided = await this.repo.decideSuggestion(
      scope,
      suggestion.id,
      valid ? 'accepted' : 'dismissed',
      now,
    );
    if (!decided) return { ok: false, errorCode: 'unknown_suggestion' };
    return valid && draft.success
      ? { ok: true, scheduleDraft: draft.data }
      : { ok: false, errorCode: 'invalid_schedule_draft' };
  }

  async runs(actor: AssistantActor, id: string, limit: number): Promise<ScheduleRunList> {
    const scope = await this.scope(actor);
    await this.#own(scope, id);
    const runs = await this.repo.listScheduleRuns(scope, id, limit);
    const delivery = await this.#deliveries(
      scope,
      runs.map((r) => r.notificationId),
    );
    return {
      items: runs.map((r) => toScheduleRunDto(r, delivery.get(r.notificationId ?? '') ?? {})),
    };
  }

  /** The draft's report computed now, rendered in the owner's language; nothing is delivered. */
  async preview(
    actor: AssistantActor,
    draft: ScheduleDraft,
    now = new Date(),
  ): Promise<SchedulePreview> {
    const scope = await this.scope(actor);
    const d: ScheduleDraftInput = { ...draft, name: draft.name.trim() };
    d.params = normaliseParams(d);
    this.#validate(scope, d, null, { email: true });
    const [computed, locale, business] = await Promise.all([
      this.reports.compute({ ...d, alertCursor: now }, now),
      this.notifications.recipientLocale(scope.ownerUserId),
      this.workspace.getById(d.businessId as WorkspaceId),
    ]);
    const { title, body } = this.reports.render(computed.result, locale, business.name);
    return {
      title,
      body,
      nextRuns: nextRuns(d.cadence, now, 3).map((x) => x.toISOString()),
    };
  }

  /**
   * "Hỏi trợ lý về báo cáo này" (S3-R10): the run's `origin: schedule` thread, created on the
   * first call and seeded with the report as its first assistant message.
   */
  async threadForRun(
    actor: AssistantActor & { ownerName: () => Promise<string | null> },
    runId: string,
  ): Promise<AssistantThreadDto> {
    const scope = await this.scope(actor);
    const run = isUuid(runId) ? await this.repo.getScheduleRun(scope, runId) : null;
    if (!run) throw new AssistantNotFoundError('schedule run', runId);
    if (run.threadId) {
      const existing = await this.repo.getThread(scope, run.threadId);
      if (existing) return toThreadDto(existing);
    }
    if (!run.title || run.body === null)
      throw new AssistantScheduleConflictError('run_has_no_report');
    const schedule = await this.repo.getSchedule(scope, run.scheduleId);
    const businessId =
      schedule && scope.businessIds.includes(schedule.businessId as WorkspaceId)
        ? (schedule.businessId as WorkspaceId)
        : scope.businessId;
    const threadScope: OwnerScope = { ...scope, businessId };
    const promptVersion = `${ASSISTANT_PROMPT.name}@${ASSISTANT_PROMPT.version}`;
    const systemPrompt = await this.prompts.build(
      threadScope,
      await actor.ownerName(),
      promptVersion,
    );
    const thread = await this.repo.createThread(threadScope, {
      id: newId(),
      title: run.title.slice(0, 120),
      systemPrompt,
      promptVersion,
      origin: 'schedule',
    });
    await this.repo.appendMessages(threadScope, thread.id, [
      {
        id: newId(),
        role: 'assistant',
        content: `${run.title}\n\n${run.body}`,
        toolCalls: null,
        toolCallId: null,
        toolName: null,
        pageContext: null,
        uiActions: [],
        runId: null,
      },
    ]);
    const stored = await this.repo.setRunThread(scope, run.id, thread.id);
    if (stored && stored !== thread.id) {
      // A concurrent call won: keep its thread, hide ours.
      await this.repo.updateThread(threadScope, thread.id, { archived: true });
      const winner = await this.repo.getThread(scope, stored);
      if (winner) return toThreadDto(winner);
    }
    return toThreadDto((await this.repo.getThread(scope, thread.id)) ?? thread);
  }
}
