import { notificationStrings } from '@agent-sales/i18n/notification';
import { newId, userId, workspaceId, type UserId, type WorkspaceId } from '@agent-sales/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountFacade, AccountMembership } from '../../account/api/index.js';
import type { NotificationFacade } from '../../notification/api/index.js';
import type { WorkspaceFacade, WorkspaceMembership } from '../../workspace/api/index.js';
import { ProposalService } from '../application/proposals.service.js';
import { ReportService } from '../application/report.service.js';
import { scheduleTool } from '../application/schedule-tools.js';
import { SchedulesService } from '../application/schedules.service.js';
import { SkillCatalog } from '../application/skill-tools.js';
import { SkillsService } from '../application/skills.service.js';
import { SuggestionsService } from '../application/suggestions.service.js';
import { ThreadPromptService } from '../application/thread-prompt.service.js';
import { AssistantScheduleInvalidError } from '../domain/assistant.errors.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type { NewSchedule } from '../domain/ports/assistant.repository.js';
import type { ReportDataSource } from '../domain/ports/report-data-source.port.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

const NOW = new Date('2026-11-02T02:00:00Z'); // 09:00 local, Monday

async function setup(opts: { email?: boolean } = {}) {
  const accountId = newId();
  const owner = userId(newId());
  const business = workspaceId(newId());
  const roles = new Map<UserId, AccountMembership[]>([
    [owner, [{ accountId, name: 'Account', role: 'owner' }]],
  ]);
  const memberships: WorkspaceMembership[] = [
    {
      workspaceId: business,
      workspaceName: 'Shop Lan',
      role: 'owner',
      industry: 'retail',
      accountId,
      createdAt: new Date(0),
    },
  ];
  const account = {
    listForUser: (u: UserId) => Promise.resolve(roles.get(u) ?? []),
  } as unknown as AccountFacade;
  const workspace = {
    accountOf: (w: WorkspaceId) => Promise.resolve(w === business ? accountId : null),
    listMemberships: (u: UserId) => Promise.resolve(u === owner ? memberships : []),
    getById: (w: WorkspaceId) => Promise.resolve({ id: w, name: 'Shop Lan' }),
  } as unknown as WorkspaceFacade;
  const repo = new InMemoryAssistantRepository();
  const notifications: NotificationFacade = {
    notify: vi.fn(),
    recipientLocale: vi.fn(async () => 'vi' as const),
    emailAvailable: () => opts.email ?? true,
    deliverySummary: vi.fn(async () => new Map()),
  };
  const data: ReportDataSource = {
    revenue: vi.fn(async () => ({
      sales: 0,
      revenue: 0,
      closedOrders: 0,
      averageOrderValue: 0,
      profit: 0,
    })),
    orders: vi.fn(async () => ({ count: 0, total: 0, latest: [] })),
    lowStock: vi.fn(async () => ({ count: 0, items: [], ids: [] })),
    awaiting: vi.fn(async () => ({ count: 0, oldestSince: null, byChannel: [], ids: [] })),
    newContacts: vi.fn(async () => ({ count: 0, bySource: [] })),
    requests: vi.fn(async () => ({ count: 0, byKind: [], byStatus: [] })),
    industry: vi.fn(async () => 'retail'),
    stays: vi.fn(async () => ({ bookings: 0, nights: 0, revenue: 0, profit: 0 })),
  };
  const reports = new ReportService(data, notificationStrings);
  const skills = new SkillsService(repo, new SkillCatalog([]));
  const prompts = new ThreadPromptService(workspace, repo, skills);
  const schedules = new SchedulesService(account, workspace, repo, notifications, reports, prompts);
  const invoke = vi.fn();
  const proposals = new ProposalService(repo, { invoke }, schedules);
  const scope: OwnerScope = {
    accountId,
    ownerUserId: owner,
    businessId: business,
    businessIds: [business],
  };
  const thread = await repo.createThread(scope, {
    id: newId(),
    title: '',
    systemPrompt: 'p',
    promptVersion: 'assistant@3',
  });
  const proposalIds: string[] = [];
  const tool = scheduleTool({
    scope,
    repo,
    schedules,
    threadId: thread.id,
    runId: newId(),
    proposalIds,
    now: () => NOW,
  });
  const call = async (input: unknown) => {
    const out = await tool.run(tool.schema.parse(input));
    return { ...out, json: JSON.parse(out.content) as Record<string, unknown> };
  };
  const seed = (over: Partial<NewSchedule> = {}) =>
    repo.createSchedule(scope, {
      id: newId(),
      businessId: business,
      name: 'Doanh thu hôm qua',
      template: 'revenue_summary',
      mode: 'report',
      params: { period: 'day', window: 'previous' },
      cadence: { kind: 'daily', at: '08:00' },
      channels: ['in_app'],
      commentary: false,
      createdBy: 'owner',
      nextRunAt: new Date('2026-11-03T01:00:00Z'),
      ...over,
    });
  const weeklyRevenue = {
    name: 'Doanh thu tuần trước',
    template: 'revenue_summary',
    mode: 'report',
    params: { period: 'week', window: 'previous' },
    cadence: { kind: 'weekly', days: [1], at: '08:00' },
    channels: ['in_app', 'email'],
    commentary: false,
  };
  return { repo, scope, thread, schedules, proposals, call, seed, weeklyRevenue, proposalIds };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('schedule tool', () => {
  it('lists the schedules with the business name and the last run', async () => {
    const t = await setup();
    const s = await t.seed();
    const out = await t.call({ action: 'list' });
    expect(out.json).toMatchObject({
      items: [
        {
          id: s.id,
          name: 'Doanh thu hôm qua',
          business: 'Shop Lan',
          template: 'revenue_summary',
          status: 'active',
          nextRunAt: '2026-11-03T01:00:00.000Z',
          lastRun: null,
        },
      ],
    });
  });

  it('turns create into a pending schedule proposal and writes no schedule', async () => {
    const t = await setup();
    const out = await t.call({
      action: 'create',
      draft: t.weeklyRevenue,
      summary: 'Gửi doanh thu tuần trước mỗi sáng thứ Hai 8h',
    });
    expect(out.json).toMatchObject({ status: 'awaiting_owner_approval' });
    expect(t.repo.schedules.size).toBe(0);
    const p = t.repo.proposals.get(out.json['proposalId'] as string)!;
    expect(p).toMatchObject({
      kind: 'schedule',
      routeKey: 'SCHEDULE create',
      path: '/assistant/schedules',
      businessId: t.scope.businessId,
      status: 'pending',
      body: { op: 'create', draft: { businessId: t.scope.businessId } },
      preview: {
        draft: { params: { period: 'week', window: 'previous' } },
        nextRuns: [
          '2026-11-09T01:00:00.000Z',
          '2026-11-16T01:00:00.000Z',
          '2026-11-23T01:00:00.000Z',
        ],
      },
    });
    expect(t.proposalIds).toEqual([p.id]);
  });

  it('answers the validation codes, summary_required and unknown_schedule', async () => {
    const t = await setup({ email: false });
    expect((await t.call({ action: 'create', draft: t.weeklyRevenue })).json).toMatchObject({
      ok: false,
      errorCode: 'summary_required',
    });
    expect(
      (await t.call({ action: 'create', draft: t.weeklyRevenue, summary: 'x' })).json,
    ).toMatchObject({ errorCode: 'email_unavailable' });
    expect(
      (
        await t.call({
          action: 'create',
          draft: { ...t.weeklyRevenue, channels: ['in_app'], mode: 'alert' },
          summary: 'x',
        })
      ).json,
    ).toMatchObject({ errorCode: 'invalid_mode' });
    expect((await t.call({ action: 'pause', scheduleId: newId() })).json).toMatchObject({
      errorCode: 'unknown_schedule',
    });
    expect(
      (await t.call({ action: 'remove', scheduleId: newId(), summary: 'x' })).json,
    ).toMatchObject({ errorCode: 'unknown_schedule' });
    expect(t.repo.proposals.size).toBe(0);
  });

  it('counts pending schedule proposals toward the limit of 10', async () => {
    const t = await setup();
    for (let i = 0; i < 9; i++) await t.seed({ name: `Lịch ${i}` });
    const draft = { ...t.weeklyRevenue, channels: ['in_app'] };
    expect((await t.call({ action: 'create', draft, summary: 'x' })).json).toMatchObject({
      status: 'awaiting_owner_approval',
    });
    expect((await t.call({ action: 'create', draft, summary: 'y' })).json).toMatchObject({
      errorCode: 'schedule_limit',
    });
  });

  it('turns edit and remove into proposals and leaves the schedule as it is', async () => {
    const t = await setup();
    const s = await t.seed();
    const edit = await t.call({
      action: 'edit',
      scheduleId: s.id,
      patch: { cadence: { kind: 'daily', at: '07:00' } },
      summary: 'Đổi sang 7h sáng',
    });
    const remove = await t.call({ action: 'remove', scheduleId: s.id, summary: 'Xoá lịch' });
    expect(t.repo.proposals.get(edit.json['proposalId'] as string)).toMatchObject({
      routeKey: 'SCHEDULE edit',
      path: `/assistant/schedules/${s.id}`,
      body: { op: 'edit', scheduleId: s.id, patch: { cadence: { at: '07:00' } } },
      preview: {
        before: { id: s.id, cadence: { at: '08:00' } },
        nextRuns: [
          '2026-11-03T00:00:00.000Z',
          '2026-11-04T00:00:00.000Z',
          '2026-11-05T00:00:00.000Z',
        ],
      },
    });
    expect(t.repo.proposals.get(remove.json['proposalId'] as string)).toMatchObject({
      routeKey: 'SCHEDULE remove',
      body: { op: 'remove', scheduleId: s.id },
    });
    expect(t.repo.schedules.get(s.id)).toMatchObject({ cadence: { at: '08:00' } });
  });

  it('pauses, resumes and runs at once; a second run is too soon', async () => {
    const t = await setup();
    const s = await t.seed();
    expect((await t.call({ action: 'pause', scheduleId: s.id })).json).toMatchObject({
      ok: true,
      status: 'paused',
      pausedReason: 'owner',
      nextRunAt: null,
    });
    expect((await t.call({ action: 'run', scheduleId: s.id })).json).toMatchObject({
      errorCode: 'schedule_paused',
    });
    expect((await t.call({ action: 'resume', scheduleId: s.id })).json).toMatchObject({
      status: 'active',
      nextRunAt: '2026-11-03T01:00:00.000Z',
    });
    expect((await t.call({ action: 'run', scheduleId: s.id })).json).toMatchObject({
      ok: true,
      runRequested: true,
    });
    expect(t.repo.schedules.get(s.id)!.runRequestedAt).toEqual(NOW);
    expect((await t.call({ action: 'run', scheduleId: s.id })).json).toMatchObject({
      errorCode: 'run_too_soon',
    });
  });
});

describe('schedule proposals', () => {
  it('applies an approved create in-process, as the assistant, without the route invoker', async () => {
    const t = await setup();
    const out = await t.call({
      action: 'create',
      draft: t.weeklyRevenue,
      summary: 'Doanh thu tuần',
    });
    const done = await t.proposals.approve(t.scope, out.json['proposalId'] as string, 'Bearer x');
    expect(done).toMatchObject({ kind: 'schedule', status: 'done' });
    const [s] = [...t.repo.schedules.values()];
    expect(s).toMatchObject({ name: 'Doanh thu tuần trước', createdBy: 'assistant' });
    expect(t.repo.proposals.get(done.id)!.resultPreview).toBe(
      JSON.stringify({ id: s!.id, name: s!.name }),
    );
    const events = (await t.repo.listMessages(t.scope, t.thread.id)).filter(
      (m) => m.role === 'event',
    );
    expect(events.at(-1)?.content).toBe('Đã áp dụng: Doanh thu tuần');
  });

  it('fails an approval once the owner reached 10 schedules', async () => {
    const t = await setup();
    const out = await t.call({
      action: 'create',
      draft: t.weeklyRevenue,
      summary: 'Doanh thu tuần',
    });
    for (let i = 0; i < 10; i++) await t.seed({ name: `Lịch ${i}` });
    const failed = await t.proposals.approve(t.scope, out.json['proposalId'] as string, 'Bearer x');
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'schedule_limit' });
    expect(t.repo.schedules.size).toBe(10);
  });

  it('applies approved edits and removals', async () => {
    const t = await setup();
    const s = await t.seed();
    const edit = await t.call({
      action: 'edit',
      scheduleId: s.id,
      patch: { name: 'Doanh thu sáng' },
      summary: 'Đổi tên',
    });
    expect(
      await t.proposals.approve(t.scope, edit.json['proposalId'] as string, 'Bearer x'),
    ).toMatchObject({ status: 'done' });
    expect(t.repo.schedules.get(s.id)!.name).toBe('Doanh thu sáng');
    const remove = await t.call({ action: 'remove', scheduleId: s.id, summary: 'Xoá' });
    expect(
      await t.proposals.approve(t.scope, remove.json['proposalId'] as string, 'Bearer x'),
    ).toMatchObject({ status: 'done' });
    expect(t.repo.schedules.has(s.id)).toBe(false);
  });
});

describe('schedule suggestion accept (S3-R12)', () => {
  it('accepts a valid payload with the current business and answers the draft', async () => {
    const t = await setup();
    const { weeklyRevenue } = t;
    const sug = await t.repo.upsertSuggestion(t.scope, {
      id: newId(),
      kind: 'schedule',
      dedupKey: 'schedule:weekly-revenue',
      title: 'Gửi doanh thu tuần mỗi thứ Hai?',
      payload: weeklyRevenue,
    });
    const out = await t.schedules.acceptSuggestion(t.scope, sug!.id, NOW);
    expect(out).toMatchObject({
      ok: true,
      scheduleDraft: { businessId: t.scope.businessId, template: 'revenue_summary' },
    });
    expect((await t.repo.listSuggestions(t.scope))[0]).toMatchObject({ status: 'accepted' });
    expect(t.repo.schedules.size).toBe(0);
  });

  it('dismisses an invalid payload and answers invalid_schedule_draft', async () => {
    const t = await setup();
    const sug = await t.repo.upsertSuggestion(t.scope, {
      id: newId(),
      kind: 'schedule',
      dedupKey: 'schedule:broken',
      title: 'x',
      payload: { name: 'x', template: 'weather' },
    });
    expect(await t.schedules.acceptSuggestion(t.scope, sug!.id, NOW)).toEqual({
      ok: false,
      errorCode: 'invalid_schedule_draft',
    });
    expect((await t.repo.listSuggestions(t.scope))[0]).toMatchObject({ status: 'dismissed' });
    expect(await t.schedules.acceptSuggestion(t.scope, sug!.id, NOW)).toEqual({
      ok: false,
      errorCode: 'unknown_suggestion',
    });
  });

  it('is wired into the 1c suggestions accept: a draft for the editor, or invalid_schedule_draft', async () => {
    const t = await setup();
    const suggestions = new SuggestionsService(
      t.repo,
      new SkillsService(t.repo, new SkillCatalog([])),
      t.schedules,
    );
    const good = await t.repo.upsertSuggestion(t.scope, {
      id: newId(),
      kind: 'schedule',
      dedupKey: 'schedule:weekly-revenue',
      title: 'Gửi doanh thu tuần mỗi thứ Hai?',
      payload: t.weeklyRevenue,
    });
    expect(await suggestions.accept(t.scope, good!.id)).toMatchObject({
      suggestion: { kind: 'schedule', status: 'accepted' },
      skill: null,
      path: null,
      scheduleDraft: { businessId: t.scope.businessId, template: 'revenue_summary' },
    });
    const bad = await t.repo.upsertSuggestion(t.scope, {
      id: newId(),
      kind: 'schedule',
      dedupKey: 'schedule:broken',
      title: 'x',
      payload: { name: 'x', template: 'weather' },
    });
    const refused = suggestions.accept(t.scope, bad!.id);
    await expect(refused).rejects.toBeInstanceOf(AssistantScheduleInvalidError);
    await expect(refused).rejects.toMatchObject({
      details: { reason: 'invalid_schedule_draft' },
    });
    expect((await t.repo.listSuggestions(t.scope)).find((x) => x.id === bad!.id)).toMatchObject({
      status: 'dismissed',
    });
  });
});
