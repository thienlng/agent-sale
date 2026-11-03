import { notificationStrings } from '@agent-sales/i18n/notification';
import { newId, userId, workspaceId, type UserId, type WorkspaceId } from '@agent-sales/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountFacade, AccountMembership } from '../../account/api/index.js';
import type { LlmGatewayPort } from '../../ai/api/index.js';
import type { NotificationFacade, NotifyInput } from '../../notification/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import { ReportService } from '../application/report.service.js';
import { ScheduleRunner, scheduleDedupKey } from '../application/schedule-runner.js';
import type { NewSchedule } from '../domain/ports/assistant.repository.js';
import type { ReportDataSource } from '../domain/ports/report-data-source.port.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

const NOW = new Date('2026-11-02T01:00:00Z'); // 08:00 local, Monday
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (ms: number) => new Date(NOW.getTime() + ms);

function setup(opts: { email?: boolean } = {}) {
  const accountId = newId();
  const owner = userId(newId());
  const business = workspaceId(newId());
  const roles = new Map<UserId, AccountMembership[]>([
    [owner, [{ accountId, name: 'Account', role: 'owner' }]],
  ]);
  const businessAccount = new Map<WorkspaceId, string | null>([[business, accountId]]);
  const members = new Set<string>([`${business}:${owner}`]);
  const account = {
    listForUser: (u: UserId) => Promise.resolve(roles.get(u) ?? []),
  } as unknown as AccountFacade;
  const workspace = {
    accountOf: (w: WorkspaceId) => Promise.resolve(businessAccount.get(w) ?? null),
    findMembership: (w: WorkspaceId, u: UserId) =>
      Promise.resolve(members.has(`${w}:${u}`) ? { workspaceId: w } : null),
    getById: (w: WorkspaceId) => Promise.resolve({ id: w, name: 'Shop Lan' }),
  } as unknown as WorkspaceFacade;
  const repo = new InMemoryAssistantRepository();
  const sent: NotifyInput[] = [];
  const keys = new Map<string, string>();
  const notify = vi.fn(async (i: NotifyInput) => {
    const existing = i.dedupKey ? keys.get(i.dedupKey) : undefined;
    if (existing) return { id: existing, deduped: true };
    const id = newId();
    if (i.dedupKey) keys.set(i.dedupKey, id);
    sent.push(i);
    return { id, deduped: false };
  });
  const notifications: NotificationFacade = {
    notify,
    recipientLocale: vi.fn(async () => 'vi' as const),
    emailAvailable: () => opts.email ?? true,
    deliverySummary: vi.fn(async () => new Map()),
  };
  const data = {
    revenue: vi.fn(async () => ({
      sales: 2_000_000,
      revenue: 1_250_000,
      closedOrders: 3,
      averageOrderValue: 416_667,
      profit: 300_000,
    })),
    orders: vi.fn(async () => ({ count: 0, total: 0, latest: [] as never[] })),
    lowStock: vi.fn(async () => ({
      count: 0,
      items: [] as { product: string; sku: string | null; available: number }[],
      ids: [] as string[],
    })),
    awaiting: vi.fn(async () => ({ count: 0, oldestSince: null, byChannel: [], ids: [] })),
    newContacts: vi.fn(async () => ({ count: 0, bySource: [] })),
    industry: vi.fn(async () => 'retail'),
    stays: vi.fn(async () => ({ bookings: 0, nights: 0, revenue: 0, profit: 0 })),
  } satisfies ReportDataSource;
  const generate = vi.fn(async () => ({
    text: 'Doanh thu hôm qua ổn định, anh/chị giữ nhịp này nhé.',
    toolCalls: [],
    provider: 'fake',
    model: 'fake-basic',
    usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 12 },
  }));
  const gateway = { generate } as unknown as LlmGatewayPort;
  const reports = new ReportService(data, notificationStrings);
  const runner = () =>
    new ScheduleRunner(repo, account, workspace, notifications, reports, gateway);
  const key = { accountId, ownerUserId: owner };
  const create = (over: Partial<NewSchedule> = {}) =>
    repo.createSchedule(key, {
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
      nextRunAt: NOW,
      ...over,
    });
  const lowStockAlert = () =>
    create({
      name: 'Sắp hết hàng',
      template: 'low_stock',
      mode: 'alert',
      params: { threshold: 3 },
      cadence: { kind: 'every', minutes: 60 },
    });
  const runsOf = (id: string) => [...repo.scheduleRuns.values()].filter((r) => r.scheduleId === id);
  return {
    repo,
    runner,
    create,
    lowStockAlert,
    runsOf,
    sent,
    notify,
    data,
    generate,
    roles,
    businessAccount,
    members,
    owner,
    business,
    key,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('ScheduleRunner', () => {
  it('runs a due daily report once and moves the next run to tomorrow', async () => {
    const t = setup();
    const s = await t.create();
    expect(await t.runner().tick(NOW)).toBe(1);
    const [run] = t.runsOf(s.id);
    expect(run).toMatchObject({ status: 'done', trigger: 'cadence', scheduledFor: NOW });
    expect(run?.title).toContain('Shop Lan');
    expect(run?.notificationId).toBeTruthy();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({
      type: 'assistant.report',
      target: { kind: 'assistant_report', runId: run?.id },
      channels: ['in_app'],
      dedupKey: scheduleDedupKey(s.id, NOW),
    });
    const after = t.repo.schedules.get(s.id)!;
    expect(after.nextRunAt?.toISOString()).toBe('2026-11-03T01:00:00.000Z');
    expect(after).toMatchObject({ leaseUntil: null, lastRunAt: NOW, consecutiveFailures: 0 });
    expect(await t.runner().tick(at(MIN))).toBe(0);
  });

  it('never records a run as finished before it started (QA M-6)', async () => {
    const t = setup();
    const s = await t.create({ nextRunAt: at(-HOUR) });
    // The tick's `now` was taken before the batch reached this schedule, and delivery takes 5 s.
    vi.setSystemTime(at(2_000));
    t.notify.mockImplementationOnce(async () => {
      vi.advanceTimersByTime(5_000);
      return { id: newId(), deduped: false };
    });
    await t.runner().tick(NOW);
    const [run] = t.runsOf(s.id);
    expect(run?.status).toBe('done');
    expect(run!.startedAt.getTime()).toBeGreaterThanOrEqual(at(2_000).getTime());
    expect(run!.finishedAt!.getTime()).toBeGreaterThanOrEqual(run!.startedAt.getTime() + 5_000);

    // A run inserted already finished (a missed slot) has started == finished at most.
    const missed = await t.create({ nextRunAt: at(-7 * HOUR) });
    await t.runner().tick(NOW);
    const [skipped] = t.runsOf(missed.id);
    expect(skipped?.status).toBe('skipped');
    expect(skipped!.finishedAt!.getTime()).toBeGreaterThanOrEqual(skipped!.startedAt.getTime());
  });

  it('gives one run when two runners tick the same slot', async () => {
    const t = setup();
    const s = await t.create();
    const [a, b] = [t.runner(), t.runner()];
    await Promise.all([a.tick(NOW), b.tick(NOW)]);
    expect(t.runsOf(s.id)).toHaveLength(1);
    expect(t.sent).toHaveLength(1);
  });

  it('records a slot 7 h late as missed and runs one 2 h late', async () => {
    const t = setup();
    const late = await t.create({ nextRunAt: at(-7 * HOUR) });
    const recent = await t.create({ nextRunAt: at(-2 * HOUR) });
    await t.runner().tick(NOW);
    expect(t.runsOf(late.id)).toMatchObject([{ status: 'skipped', errorCode: 'missed' }]);
    expect(t.runsOf(recent.id)).toMatchObject([{ status: 'done' }]);
    expect(t.repo.schedules.get(late.id)!.nextRunAt!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(t.sent).toHaveLength(1);
  });

  it('runs a manual request at once and keeps the cadence', async () => {
    const t = setup();
    const s = await t.create({ nextRunAt: at(HOUR) });
    await t.repo.updateSchedule(t.key, s.id, { runRequestedAt: NOW });
    await t.runner().tick(at(10_000));
    expect(t.runsOf(s.id)).toMatchObject([{ status: 'done', trigger: 'manual' }]);
    const after = t.repo.schedules.get(s.id)!;
    expect(after.runRequestedAt).toBeNull();
    expect(after.nextRunAt).toEqual(at(HOUR));
  });

  it('runs a cadence slot claimed with a manual request on the next tick', async () => {
    const t = setup();
    const s = await t.create({ nextRunAt: NOW });
    await t.repo.updateSchedule(t.key, s.id, { runRequestedAt: at(-MIN) });
    const runner = t.runner();
    await runner.tick(NOW);
    expect(t.repo.schedules.get(s.id)).toMatchObject({ runRequestedAt: null, nextRunAt: NOW });
    await runner.tick(at(MIN));
    expect(t.runsOf(s.id)).toMatchObject([
      { trigger: 'manual', status: 'done', scheduledFor: at(-MIN) },
      { trigger: 'cadence', status: 'done', scheduledFor: NOW },
    ]);
    expect(t.repo.schedules.get(s.id)!.nextRunAt?.toISOString()).toBe('2026-11-03T01:00:00.000Z');
    expect(t.sent).toHaveLength(2);
  });

  it('keeps a "run now" and a cadence edit made while the run is in flight', async () => {
    const t = setup();
    const s = await t.create();
    const requested = at(30_000);
    t.notify.mockImplementationOnce(async () => {
      await t.repo.updateSchedule(t.key, s.id, {
        runRequestedAt: requested,
        cadence: { kind: 'weekly', days: [3], at: '09:00' },
      });
      return { id: newId(), deduped: false };
    });
    const runner = t.runner();
    await runner.tick(NOW);
    const after = t.repo.schedules.get(s.id)!;
    expect(after).toMatchObject({ runRequestedAt: requested, leaseUntil: null, lastRunAt: NOW });
    // Wednesday 09:00 local, from the edited cadence.
    expect(after.nextRunAt?.toISOString()).toBe('2026-11-04T02:00:00.000Z');
    await runner.tick(at(MIN));
    expect(t.runsOf(s.id)).toMatchObject([
      { trigger: 'cadence', status: 'done' },
      { trigger: 'manual', status: 'done', scheduledFor: requested },
    ]);
  });

  it('resolves a late cadence report period from its slot, not the tick', async () => {
    const t = setup();
    const slot = new Date('2026-11-01T15:00:00Z'); // 22:00 local, Sunday 1 November
    const late = new Date('2026-11-01T19:00:00Z'); // 02:00 local, Monday 2 November
    const today = await t.create({
      params: { period: 'day', window: 'to_date' },
      cadence: { kind: 'daily', at: '22:00' },
      nextRunAt: slot,
    });
    await t.runner().tick(late);
    expect(t.data.revenue).toHaveBeenLastCalledWith(t.business, '2026-11-01', '2026-11-01');
    expect(t.runsOf(today.id)[0]?.report).toMatchObject({
      period: { from: '2026-11-01', to: '2026-11-01' },
    });

    const u = setup();
    // Slot 23:50 local on 1 November, run at 00:10 local on 2 November: "yesterday" is 31 October.
    await u.create({
      cadence: { kind: 'daily', at: '23:50' },
      nextRunAt: at(-8 * HOUR - 10 * MIN),
    });
    await u.runner().tick(at(-8 * HOUR + 10 * MIN));
    expect(u.data.revenue).toHaveBeenLastCalledWith(u.business, '2026-10-31', '2026-10-31');
  });

  it('pauses on a gone business and tells the owner', async () => {
    const t = setup();
    const s = await t.create();
    t.businessAccount.set(t.business, null);
    await t.runner().tick(NOW);
    expect(t.runsOf(s.id)).toMatchObject([
      { status: 'blocked', errorCode: 'business_unavailable' },
    ]);
    expect(t.repo.schedules.get(s.id)).toMatchObject({
      status: 'paused',
      pausedReason: 'business_unavailable',
      nextRunAt: null,
    });
    expect(t.sent).toMatchObject([
      {
        type: 'assistant.schedule_paused',
        target: { kind: 'path', path: '/app' },
        channels: ['in_app'],
      },
    ]);
    expect(t.data.revenue).not.toHaveBeenCalled();
  });

  it('pauses when the owner left the business', async () => {
    const t = setup();
    const s = await t.create();
    t.members.clear();
    await t.runner().tick(NOW);
    expect(t.repo.schedules.get(s.id)).toMatchObject({ pausedReason: 'business_unavailable' });
    expect(t.sent).toHaveLength(1);
  });

  it('pauses without a notice when the user is no longer an owner', async () => {
    const t = setup();
    const s = await t.create();
    t.roles.clear();
    await t.runner().tick(NOW);
    expect(t.runsOf(s.id)).toMatchObject([{ status: 'blocked', errorCode: 'owner_not_active' }]);
    expect(t.repo.schedules.get(s.id)).toMatchObject({ pausedReason: 'owner_not_active' });
    expect(t.notify).not.toHaveBeenCalled();
  });

  it('pauses after 3 failures in a row and a success in between resets the count', async () => {
    const t = setup();
    const s = await t.create({ cadence: { kind: 'every', minutes: 60 } });
    const runner = t.runner();
    t.data.revenue.mockRejectedValueOnce(new Error('db down'));
    await runner.tick(NOW);
    t.data.revenue.mockRejectedValueOnce(new Error('db down'));
    await runner.tick(at(HOUR));
    expect(t.repo.schedules.get(s.id)!.consecutiveFailures).toBe(2);
    await runner.tick(at(2 * HOUR));
    expect(t.repo.schedules.get(s.id)!.consecutiveFailures).toBe(0);
    for (const h of [3, 4, 5]) {
      t.data.revenue.mockRejectedValueOnce(new Error('db down'));
      await runner.tick(at(h * HOUR));
    }
    expect(t.repo.schedules.get(s.id)).toMatchObject({
      status: 'paused',
      pausedReason: 'failures',
      consecutiveFailures: 3,
      nextRunAt: null,
    });
    expect(t.runsOf(s.id).filter((r) => r.status === 'failed')).toHaveLength(5);
    expect(t.runsOf(s.id)[0]).toMatchObject({ errorCode: 'compute_failed' });
    expect(t.sent.at(-1)).toMatchObject({ type: 'assistant.schedule_paused' });
  });

  it('leaves no run row for an alert check with no hit', async () => {
    const t = setup();
    const s = await t.lowStockAlert();
    await t.runner().tick(NOW);
    expect(t.runsOf(s.id)).toHaveLength(0);
    expect(t.repo.schedules.get(s.id)).toMatchObject({ lastCheckedAt: NOW, leaseUntil: null });
    expect(t.repo.schedules.get(s.id)!.nextRunAt?.getTime()).toBe(at(HOUR).getTime());
    expect(t.notify).not.toHaveBeenCalled();
  });

  it('resets the failure count on a quiet alert check', async () => {
    const t = setup();
    const s = await t.lowStockAlert();
    const runner = t.runner();
    t.data.lowStock.mockRejectedValueOnce(new Error('db down'));
    await runner.tick(NOW);
    t.data.lowStock.mockRejectedValueOnce(new Error('db down'));
    await runner.tick(at(HOUR));
    expect(t.repo.schedules.get(s.id)!.consecutiveFailures).toBe(2);
    await runner.tick(at(2 * HOUR)); // quiet: no hit
    expect(t.repo.schedules.get(s.id)!.consecutiveFailures).toBe(0);
    t.data.lowStock.mockRejectedValueOnce(new Error('db down'));
    await runner.tick(at(3 * HOUR));
    expect(t.repo.schedules.get(s.id)).toMatchObject({ status: 'active', consecutiveFailures: 1 });
  });

  it('fires an unchanged alert once, not again at 23 h, again at 24 h', async () => {
    const t = setup();
    const s = await t.lowStockAlert();
    t.data.lowStock.mockResolvedValue({
      count: 1,
      items: [{ product: 'Áo thun', sku: 'AT-1', available: 2 }],
      ids: ['v1'],
    });
    const runner = t.runner();
    await runner.tick(NOW);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({
      type: 'assistant.alert',
      target: { kind: 'path', path: '/app/products' },
    });
    for (let h = 1; h <= 23; h++) await runner.tick(at(h * HOUR));
    expect(t.sent).toHaveLength(1);
    await runner.tick(at(24 * HOUR));
    expect(t.sent).toHaveLength(2);
    expect(t.runsOf(s.id)).toHaveLength(2);
  });

  it('moves the new-orders cursor only when the alert fires', async () => {
    const t = setup();
    const s = await t.create({
      name: 'Đơn mới',
      template: 'new_orders',
      mode: 'alert',
      params: { minCount: 2 },
      cadence: { kind: 'every', minutes: 15 },
      alertCursor: at(-15 * MIN),
    });
    const runner = t.runner();
    t.data.orders.mockResolvedValueOnce({ count: 1, total: 100_000, latest: [] });
    await runner.tick(NOW);
    expect(t.data.orders).toHaveBeenLastCalledWith(t.business, at(-15 * MIN), NOW);
    expect(t.repo.schedules.get(s.id)!.alertCursor).toEqual(at(-15 * MIN));
    t.data.orders.mockResolvedValueOnce({ count: 2, total: 300_000, latest: [] });
    await runner.tick(at(15 * MIN));
    expect(t.data.orders).toHaveBeenLastCalledWith(t.business, at(-15 * MIN), at(15 * MIN));
    expect(t.repo.schedules.get(s.id)!.alertCursor).toEqual(at(15 * MIN));
    expect(t.sent).toMatchObject([{ type: 'assistant.alert', target: { path: '/app/orders' } }]);
  });

  it('keeps the new-orders cursor when the alert cannot be delivered', async () => {
    const t = setup();
    const s = await t.create({
      name: 'Đơn mới',
      template: 'new_orders',
      mode: 'alert',
      params: { minCount: 1 },
      cadence: { kind: 'every', minutes: 15 },
      alertCursor: at(-15 * MIN),
    });
    t.data.orders.mockResolvedValueOnce({ count: 2, total: 300_000, latest: [] });
    t.notify.mockRejectedValueOnce(new Error('db down'));
    await t.runner().tick(NOW);
    expect(t.repo.schedules.get(s.id)).toMatchObject({
      alertCursor: at(-15 * MIN),
      lastCheckedAt: NOW,
      consecutiveFailures: 1,
    });
    expect(t.runsOf(s.id)).toMatchObject([{ status: 'failed' }]);
  });

  it('appends a safe commentary and records it as a schedule run', async () => {
    const t = setup();
    const s = await t.create({ commentary: true });
    await t.runner().tick(NOW);
    const [run] = t.runsOf(s.id);
    expect(run?.body).toContain('Nhận xét của trợ lý: Doanh thu hôm qua ổn định');
    expect(t.repo.runs.get(run!.commentaryRunId!)).toMatchObject({
      kind: 'schedule',
      tier: 'basic',
      status: 'done',
      threadId: null,
    });
    expect(t.generate).toHaveBeenCalledWith(expect.objectContaining({ tier: 'basic' }));
  });

  it('drops an unsafe commentary and still delivers on a gateway error', async () => {
    const t = setup();
    const s = await t.create({ commentary: true });
    t.generate.mockResolvedValueOnce({
      text: 'Xem chi tiết tại https://evil.example',
      toolCalls: [],
      provider: 'fake',
      model: 'fake-basic',
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
    });
    await t.runner().tick(NOW);
    expect(t.runsOf(s.id)[0]?.body).not.toContain('evil');
    expect(t.runsOf(s.id)[0]).toMatchObject({ status: 'done' });

    const u = setup();
    const v = await u.create({ commentary: true });
    u.generate.mockRejectedValueOnce(new Error('provider down'));
    await u.runner().tick(NOW);
    expect(u.runsOf(v.id)[0]).toMatchObject({ status: 'done' });
    expect(u.runsOf(v.id)[0]?.body).not.toContain('Nhận xét');
    expect(u.sent).toHaveLength(1);
  });

  it('drops email when it is unavailable and says so', async () => {
    const t = setup({ email: false });
    await t.create({ channels: ['in_app', 'email'] });
    await t.runner().tick(NOW);
    expect(t.sent[0]?.channels).toEqual(['in_app']);
    expect(t.sent[0]?.body).toContain('Không gửi được email lần này');
  });

  it('resumes a slot a crashed worker left running, and the notice dedups', async () => {
    const t = setup();
    const s = await t.create();
    const crashFinish = vi.spyOn(t.repo, 'finishScheduleRun').mockRejectedValue(new Error('crash'));
    const crashSave = vi.spyOn(t.repo, 'saveScheduleState').mockRejectedValue(new Error('crash'));
    await t.runner().tick(NOW);
    crashFinish.mockRestore();
    crashSave.mockRestore();
    expect(t.runsOf(s.id)).toMatchObject([{ status: 'running' }]);
    // The lease lapses; another worker takes the same slot over.
    await t.runner().tick(at(6 * MIN));
    expect(t.notify).toHaveBeenCalledTimes(2);
    expect(await t.notify.mock.results[1]?.value).toMatchObject({ deduped: true });
    expect(t.runsOf(s.id)).toMatchObject([{ status: 'done' }]);
    expect(t.sent).toHaveLength(1);
  });

  it('purges runs older than 90 days once a day', async () => {
    const t = setup();
    const purge = vi.spyOn(t.repo, 'purgeOldScheduleRuns');
    const runner = t.runner();
    await runner.tick(NOW);
    await runner.tick(at(MIN));
    expect(purge).toHaveBeenCalledTimes(1);
    expect(purge).toHaveBeenCalledWith(at(-90 * 24 * HOUR));
    await runner.tick(at(24 * HOUR));
    expect(purge).toHaveBeenCalledTimes(2);
  });
});
