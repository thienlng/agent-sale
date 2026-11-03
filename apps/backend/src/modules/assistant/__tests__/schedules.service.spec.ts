import type { ScheduleDraft } from '@agent-sales/contracts';
import { notificationStrings } from '@agent-sales/i18n/notification';
import { newId, userId, workspaceId, type UserId, type WorkspaceId } from '@agent-sales/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountFacade, AccountMembership } from '../../account/api/index.js';
import type { NotificationFacade } from '../../notification/api/index.js';
import type { WorkspaceFacade, WorkspaceMembership } from '../../workspace/api/index.js';
import { ReportService } from '../application/report.service.js';
import { SchedulesService } from '../application/schedules.service.js';
import { SkillCatalog } from '../application/skill-tools.js';
import { SkillsService } from '../application/skills.service.js';
import { ThreadPromptService } from '../application/thread-prompt.service.js';
import {
  AssistantForbiddenError,
  AssistantNotFoundError,
  AssistantScheduleConflictError,
  AssistantScheduleInvalidError,
} from '../domain/assistant.errors.js';
import type { ReportDataSource } from '../domain/ports/report-data-source.port.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

const NOW = new Date('2026-11-02T02:00:00Z'); // 09:00 local, Monday

function setup(opts: { email?: boolean } = {}) {
  const accountId = newId();
  const owner = userId(newId());
  const staff = userId(newId());
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
      sales: 2_000_000,
      revenue: 1_250_000,
      closedOrders: 3,
      averageOrderValue: 416_667,
      profit: 300_000,
    })),
    orders: vi.fn(async () => ({ count: 0, total: 0, latest: [] })),
    lowStock: vi.fn(async () => ({ count: 0, items: [], ids: [] })),
    awaiting: vi.fn(async () => ({ count: 0, oldestSince: null, byChannel: [], ids: [] })),
    newContacts: vi.fn(async () => ({ count: 0, bySource: [] })),
    industry: vi.fn(async () => 'retail'),
    stays: vi.fn(async () => ({ bookings: 0, nights: 0, revenue: 0, profit: 0 })),
  };
  const reports = new ReportService(data, notificationStrings);
  const skills = new SkillsService(repo, new SkillCatalog([]));
  const prompts = new ThreadPromptService(workspace, repo, skills);
  const service = new SchedulesService(account, workspace, repo, notifications, reports, prompts);
  const me = { userId: owner, businessId: business };
  const draft = (over: Partial<ScheduleDraft> = {}): ScheduleDraft => ({
    name: 'Doanh thu hôm qua',
    businessId: business,
    template: 'revenue_summary',
    mode: 'report',
    params: {},
    cadence: { kind: 'daily', at: '08:00' },
    channels: ['in_app'],
    commentary: false,
    ...over,
  });
  return { service, repo, me, staff, business, accountId, owner, draft, data, notifications };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('SchedulesService', () => {
  it('creates a schedule with defaults and its next run, and lists it', async () => {
    const { service, me, draft } = setup();
    const created = await service.create(me, draft());
    expect(created).toMatchObject({
      status: 'active',
      params: { period: 'day', window: 'previous' },
      nextRunAt: '2026-11-03T01:00:00.000Z',
      createdBy: 'owner',
      lastRun: null,
    });
    const list = await service.list(me);
    expect(list).toMatchObject({ limit: 10, used: 1, emailAvailable: true });
    expect(list.items.map((x) => x.id)).toEqual([created.id]);
  });

  it('refuses staff, unknown businesses, the limit and email while it is off', async () => {
    const { service, me, staff, draft } = setup({ email: false });
    await expect(service.list({ ...me, userId: staff })).rejects.toBeInstanceOf(
      AssistantForbiddenError,
    );
    await expect(
      service.create(me, draft({ businessId: workspaceId(newId()) })),
    ).rejects.toMatchObject({ details: { reason: 'unknown_business' } });
    await expect(
      service.create(me, draft({ channels: ['in_app', 'email'] })),
    ).rejects.toMatchObject({ details: { reason: 'email_unavailable' } });
    for (let i = 0; i < 10; i++) await service.create(me, draft());
    await expect(service.create(me, draft())).rejects.toBeInstanceOf(AssistantScheduleInvalidError);
  });

  it('starts a new-orders alert at now and resets alert state on a params edit', async () => {
    const { service, me, draft, repo } = setup();
    const alert = await service.create(
      me,
      draft({
        template: 'low_stock',
        mode: 'alert',
        params: { threshold: 3 },
        cadence: { kind: 'every', minutes: 30 },
      }),
    );
    await repo.updateSchedule(
      { accountId: repo.schedules.get(alert.id)!.accountId, ownerUserId: me.userId },
      alert.id,
      { alertFingerprint: 'fp', lastAlertedAt: NOW },
    );
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    const renamed = await service.update(me, alert.id, { name: 'Hết hàng' });
    expect(repo.schedules.get(renamed.id)?.alertFingerprint).toBe('fp');
    await service.update(me, alert.id, { params: { threshold: 10 } });
    expect(repo.schedules.get(alert.id)).toMatchObject({
      alertFingerprint: null,
      lastAlertedAt: null,
      params: { threshold: 10 },
    });
    expect(repo.schedules.get(alert.id)?.alertCursor?.getTime()).toBe(NOW.getTime() + 60_000);

    const orders = await service.create(
      me,
      draft({ template: 'new_orders', mode: 'alert', cadence: { kind: 'every', minutes: 15 } }),
    );
    expect(repo.schedules.get(orders.id)?.alertCursor?.getTime()).toBe(NOW.getTime() + 60_000);
    await expect(
      service.update(me, orders.id, { cadence: { kind: 'daily', at: '08:00' } }),
    ).rejects.toMatchObject({ details: { reason: 'alert_needs_every' } });
    await expect(
      service.update(me, orders.id, { name: 'x', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }),
    ).rejects.toBeInstanceOf(AssistantScheduleConflictError);
  });

  it('pauses, resumes, runs now once per 5 minutes and removes', async () => {
    const { service, me, draft, repo, accountId } = setup();
    const s = await service.create(me, draft());
    expect(await service.pause(me, s.id)).toMatchObject({
      status: 'paused',
      pausedReason: 'owner',
      nextRunAt: null,
    });
    await expect(service.requestRun(me, s.id)).rejects.toMatchObject({
      details: { reason: 'schedule_paused' },
    });
    repo.schedules.get(s.id)!.consecutiveFailures = 2;
    expect(await service.resume(me, s.id)).toMatchObject({
      status: 'active',
      pausedReason: null,
      nextRunAt: '2026-11-03T01:00:00.000Z',
    });
    expect(repo.schedules.get(s.id)?.consecutiveFailures).toBe(0);

    await service.requestRun(me, s.id);
    await expect(service.requestRun(me, s.id)).rejects.toMatchObject({
      details: { reason: 'run_too_soon' },
    });
    // The runner took the request and ran it: a manual run 4 minutes ago still blocks.
    await repo.saveScheduleState(
      s.id,
      {},
      { runRequestedAt: repo.schedules.get(s.id)!.runRequestedAt, advanceFrom: null },
    );
    await repo.insertScheduleRun({
      id: newId(),
      accountId,
      ownerUserId: me.userId,
      scheduleId: s.id,
      trigger: 'manual',
      scheduledFor: NOW,
    });
    vi.setSystemTime(new Date(NOW.getTime() + 4 * 60_000));
    await expect(service.requestRun(me, s.id)).rejects.toMatchObject({
      details: { reason: 'run_too_soon' },
    });
    vi.setSystemTime(new Date(NOW.getTime() + 6 * 60_000));
    await expect(service.requestRun(me, s.id)).resolves.toMatchObject({ id: s.id });

    await service.remove(me, s.id);
    await expect(service.remove(me, s.id)).rejects.toBeInstanceOf(AssistantNotFoundError);
    await expect(service.pause(me, s.id)).rejects.toBeInstanceOf(AssistantNotFoundError);
  });

  it('previews a draft without delivering it', async () => {
    const { service, me, draft, notifications, data } = setup();
    const preview = await service.preview(me, draft());
    expect(preview.title).toBe('Doanh thu hôm qua (01/11) · Shop Lan');
    expect(preview.body).toContain('Doanh thu: 1.250.000 ₫');
    expect(preview.nextRuns).toEqual([
      '2026-11-03T01:00:00.000Z',
      '2026-11-04T01:00:00.000Z',
      '2026-11-05T01:00:00.000Z',
    ]);
    expect(data.revenue).toHaveBeenCalledWith(expect.any(String), '2026-11-01', '2026-11-01');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('creates the thread of a report run once', async () => {
    const { service, me, draft, repo, accountId } = setup();
    const s = await service.create(me, draft());
    const run = await repo.insertScheduleRun({
      id: newId(),
      accountId,
      ownerUserId: me.userId,
      scheduleId: s.id,
      trigger: 'cadence',
      scheduledFor: NOW,
    });
    await expect(
      service.threadForRun({ ...me, ownerName: async () => 'Lan' }, run!.id),
    ).rejects.toMatchObject({ details: { reason: 'run_has_no_report' } });
    await repo.finishScheduleRun(run!.id, {
      status: 'done',
      title: 'Doanh thu hôm qua',
      body: 'Doanh thu: 1.250.000 ₫',
    });
    const first = await service.threadForRun({ ...me, ownerName: async () => 'Lan' }, run!.id);
    const again = await service.threadForRun({ ...me, ownerName: async () => 'Lan' }, run!.id);
    expect(again.id).toBe(first.id);
    expect(first.title).toBe('Doanh thu hôm qua');
    expect(repo.threads.get(first.id)?.origin).toBe('schedule');
    const messages = repo.messages.filter((m) => m.threadId === first.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'assistant' });
    expect(messages[0]?.content).toContain('1.250.000 ₫');
    await expect(
      service.threadForRun({ ...me, ownerName: async () => 'Lan' }, newId()),
    ).rejects.toBeInstanceOf(AssistantNotFoundError);
  });
});
