import type { RunnableTool, ToolDefinition } from '@agent-sales/ai-core';
import { ScheduleDraftFields, SchedulePatchFields } from '@agent-sales/contracts';
import { newId } from '@agent-sales/shared';
import { z } from 'zod';

import { nextRuns } from '../domain/cadence.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type { AssistantRepository } from '../domain/ports/assistant.repository.js';
import type { ScheduleDraftInput } from '../domain/schedule.js';
import { MAX_PENDING_PROPOSALS, PROPOSAL_TTL_MS } from './route-tools.js';
import {
  type ScheduleProposalBody,
  type SchedulesService,
  scheduleErrorCode,
} from './schedules.service.js';
import { toScheduleDto } from './schedule-mappers.js';

export const SCHEDULE_TOOL = 'schedule';
/** The toolset the `schedule` tool belongs to; the 1c settings can disable it. */
export const SCHEDULE_TOOLSET = 'schedule';
/** How many next run times a schedule proposal previews. */
export const PREVIEW_NEXT_RUNS = 3;

const ScheduleToolInput = z.object({
  action: z.enum(['create', 'list', 'edit', 'pause', 'resume', 'run', 'remove']),
  scheduleId: z.string().max(64).optional(),
  /** create: `businessId` defaults to the current business. */
  draft: ScheduleDraftFields.extend({ businessId: z.uuid().optional() }).optional(),
  /** edit: only the fields that change. */
  patch: SchedulePatchFields.omit({ expectedUpdatedAt: true }).optional(),
  summary: z.string().max(300).optional(),
});
type ScheduleToolInput = z.output<typeof ScheduleToolInput>;

export const SCHEDULE_TOOL_DEFINITION: ToolDefinition = {
  name: SCHEDULE_TOOL,
  description:
    'The owner’s report and alert schedules; Rapiz computes and sends them. list: the schedules ' +
    '(at most 10). create (draft), edit (scheduleId + patch) and remove (scheduleId) become a ' +
    'proposal the owner approves; give `summary` (Vietnamese, ≤ 300 chars). pause, resume and run ' +
    '(send once now) act at once. Templates: revenue_summary, new_customers (report; params ' +
    '{period: day|week|month, window: previous|to_date}); new_orders (report: same params; alert: ' +
    '{minCount}); new_requests (requests the bot recorded: placement tests, trial classes, ' +
    'consultations, appointments, demos; report: period params; alert: {minCount}; both take ' +
    'kinds: only these request kinds, e.g. ["appointment"] when the owner asks for bookings only; ' +
    'omit for every kind); low_stock ' +
    '({threshold}); unanswered_conversations ({minutes, minCount}). Cadence ' +
    '(Asia/Ho_Chi_Minh): daily {at:"HH:mm"}, weekly {days:[1=Mon…7=Sun], at}, monthly {day: 1–28 ' +
    'or -1 = last day, at}, every {minutes, activeFrom?, activeTo?}; alerts use every only. ' +
    'channels always include in_app; add email only when the owner asks for it.',
  input: ScheduleToolInput,
};

/** One turn's `schedule` tool: the owner, the thread and the proposals made so far. */
export interface ScheduleToolContext {
  scope: OwnerScope;
  repo: AssistantRepository;
  schedules: SchedulesService;
  threadId: string;
  runId: string;
  /** Proposals made during the turn, in order (shared with the route tools). */
  proposalIds: string[];
  now?: () => Date;
}

/** `<` is escaped so a result cannot open or close a prompt tag. */
const json = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c');
const fail = (errorCode: string, extra: Record<string, unknown> = {}) => ({
  content: json({ ok: false, errorCode, ...extra }),
  ok: false,
});

/**
 * The `schedule` tool (S3-R11). create, edit and remove never write a schedule: they validate
 * the draft (the limit counts pending schedule proposals) and store a `kind: 'schedule'`
 * proposal the owner approves; pause, resume and run act at once through `SchedulesService`.
 */
export function scheduleTool(ctx: ScheduleToolContext): RunnableTool {
  const now = ctx.now ?? (() => new Date());

  async function propose(
    body: ScheduleProposalBody,
    summary: string,
    draft: ScheduleDraftInput,
    before?: unknown,
  ) {
    const at = now();
    const waiting = (await ctx.repo.listProposals(ctx.scope, ctx.threadId)).filter(
      (x) => x.status === 'pending' && x.expiresAt.getTime() > at.getTime(),
    );
    if (waiting.length >= MAX_PENDING_PROPOSALS) {
      return fail('too_many_pending', { max: MAX_PENDING_PROPOSALS });
    }
    const proposal = await ctx.repo.createProposal(ctx.scope, {
      id: newId(),
      kind: 'schedule',
      threadId: ctx.threadId,
      runId: ctx.runId,
      businessId: draft.businessId,
      routeKey: `SCHEDULE ${body.op}`,
      path:
        body.op === 'create' ? '/assistant/schedules' : `/assistant/schedules/${body.scheduleId}`,
      query: null,
      body,
      summary,
      preview: {
        draft,
        ...(before !== undefined ? { before } : {}),
        nextRuns: nextRuns(draft.cadence, at, PREVIEW_NEXT_RUNS).map((d) => d.toISOString()),
      },
      expiresAt: new Date(at.getTime() + PROPOSAL_TTL_MS),
    });
    ctx.proposalIds.push(proposal.id);
    return { content: json({ status: 'awaiting_owner_approval', proposalId: proposal.id }) };
  }

  async function create(input: ScheduleToolInput, summary: string) {
    if (!input.draft) return fail('draft_required');
    const draft: ScheduleDraftInput = {
      ...input.draft,
      businessId: input.draft.businessId ?? ctx.scope.businessId,
    };
    const checked = ctx.schedules.check(
      ctx.scope,
      draft,
      await ctx.schedules.used(ctx.scope, now()),
    );
    const [problem] = checked.problems;
    if (problem) return fail(problem, { problems: checked.problems });
    const d = checked.draft;
    return propose({ op: 'create', draft: d }, summary, d);
  }

  async function edit(input: ScheduleToolInput, id: string, summary: string) {
    const patch = input.patch ?? {};
    if (Object.keys(patch).length === 0) return fail('patch_required');
    let merged;
    try {
      merged = await ctx.schedules.merge(ctx.scope, id, patch);
    } catch (e) {
      return fail(scheduleErrorCode(e));
    }
    const checked = ctx.schedules.check(
      ctx.scope,
      merged.merged,
      null,
      merged.email === undefined ? {} : { email: merged.email },
    );
    const [problem] = checked.problems;
    if (problem) return fail(problem, { problems: checked.problems });
    return propose(
      { op: 'edit', scheduleId: id, patch },
      summary,
      checked.draft,
      toScheduleDto(merged.current, null, {}),
    );
  }

  async function remove(id: string, summary: string) {
    const current = await ctx.schedules.find(ctx.scope, id);
    if (!current) return fail('unknown_schedule');
    const dto = toScheduleDto(current, null, {});
    return propose(
      { op: 'remove', scheduleId: id },
      summary,
      {
        name: current.name,
        businessId: current.businessId,
        template: current.template,
        mode: current.mode,
        params: current.params,
        cadence: current.cadence,
        channels: current.channels,
        commentary: current.commentary,
      },
      dto,
    );
  }

  /** pause, resume and run: at once, answering the new state. */
  async function act(action: 'pause' | 'resume' | 'run', id: string) {
    try {
      const s =
        action === 'pause'
          ? await ctx.schedules.pauseFor(ctx.scope, id)
          : action === 'resume'
            ? await ctx.schedules.resumeFor(ctx.scope, id, now())
            : await ctx.schedules.requestRunFor(ctx.scope, id, now());
      return {
        content: json({
          ok: true,
          id: s.id,
          name: s.name,
          status: s.status,
          pausedReason: s.pausedReason,
          nextRunAt: s.nextRunAt,
          ...(action === 'run' ? { runRequested: true } : {}),
        }),
      };
    } catch (e) {
      return fail(scheduleErrorCode(e));
    }
  }

  return {
    name: SCHEDULE_TOOL,
    // create/edit/remove make proposals and run/pause change state: calls run in order.
    readOnly: false,
    schema: ScheduleToolInput,
    async run(raw) {
      const input = raw as ScheduleToolInput;
      if (input.action === 'list') {
        return { content: json({ items: await ctx.schedules.toolList(ctx.scope) }) };
      }
      const summary = input.summary?.trim();
      if (input.action === 'create') {
        if (!summary) return fail('summary_required');
        return create(input, summary);
      }
      const id = input.scheduleId;
      if (!id) return fail('unknown_schedule');
      switch (input.action) {
        case 'edit':
          if (!summary) return fail('summary_required');
          return edit(input, id, summary);
        case 'remove':
          if (!summary) return fail('summary_required');
          return remove(id, summary);
        default:
          return act(input.action, id);
      }
    },
  };
}
