import { newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import type { OwnerScope } from '../domain/owner-scope.js';
import type { NewSchedule } from '../domain/ports/assistant.repository.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

/** The in-memory twin mirrors the Drizzle schedule methods (T-172). */
const BUSINESS = workspaceId(newId());
const scope = (accountId: string = newId()): OwnerScope => ({
  accountId,
  ownerUserId: userId(newId()),
  businessId: BUSINESS,
  businessIds: [BUSINESS],
});
const draft = (over: Partial<NewSchedule> = {}): NewSchedule => ({
  id: newId(),
  businessId: BUSINESS,
  name: 'Doanh thu hôm qua',
  template: 'revenue_summary',
  mode: 'report',
  params: { period: 'day', window: 'previous' },
  cadence: { kind: 'daily', at: '08:00' },
  channels: ['in_app'],
  commentary: false,
  createdBy: 'owner',
  nextRunAt: new Date(Date.now() - 60_000),
  ...over,
});
const run = (s: OwnerScope, scheduleId: string, at = '2026-11-02T01:00:00Z') => ({
  id: newId(),
  accountId: s.accountId,
  ownerUserId: s.ownerUserId,
  scheduleId,
  trigger: 'cadence' as const,
  scheduledFor: new Date(at),
});

describe('InMemoryAssistantRepository schedules', () => {
  it('keeps schedules per owner and applies the optimistic lock', async () => {
    const repo = new InMemoryAssistantRepository();
    const a = scope();
    const sameAccount = { ...scope(a.accountId) };
    const x = await repo.createSchedule(a, draft());
    expect(x.status).toBe('active');
    expect(await repo.countSchedules(a)).toBe(1);
    expect(await repo.getSchedule(sameAccount, x.id)).toBeNull();
    expect(await repo.listSchedules(sameAccount)).toEqual([]);
    expect(await repo.updateSchedule(sameAccount, x.id, { name: 'y' })).toBeNull();
    expect(await repo.deleteSchedule(sameAccount, x.id)).toBe(false);

    const u = await repo.updateSchedule(a, x.id, { name: 'Mới' }, x.updatedAt);
    expect(u?.name).toBe('Mới');
    expect(await repo.updateSchedule(a, x.id, { name: 'Cũ' }, x.updatedAt)).toBeNull();
  });

  it('mirrors the CHECK constraints', async () => {
    const repo = new InMemoryAssistantRepository();
    const a = scope();
    await expect(repo.createSchedule(a, draft({ channels: ['email'] }))).rejects.toThrow();
    await expect(
      repo.createSchedule(a, draft({ mode: 'alert', template: 'revenue_summary' })),
    ).rejects.toThrow();
    await expect(repo.createSchedule(a, draft({ name: 'x'.repeat(81) }))).rejects.toThrow();
  });

  it('allows one run per slot, cascades on delete and sets the thread once', async () => {
    const repo = new InMemoryAssistantRepository();
    const a = scope();
    const x = await repo.createSchedule(a, draft());
    const r = await repo.insertScheduleRun(run(a, x.id));
    expect(r?.status).toBe('running');
    expect(await repo.insertScheduleRun(run(a, x.id))).toBeNull();

    const t1 = await repo.createThread(a, {
      id: newId(),
      title: 'x',
      systemPrompt: 'p',
      promptVersion: 'v',
      origin: 'schedule',
    });
    const t2 = await repo.createThread(a, {
      id: newId(),
      title: 'y',
      systemPrompt: 'p',
      promptVersion: 'v',
    });
    expect(await repo.setRunThread(a, r!.id, t1.id)).toBe(t1.id);
    expect(await repo.setRunThread(a, r!.id, t2.id)).toBe(t1.id);
    expect(repo.threads.get(t1.id)?.origin).toBe('schedule');
    const other = scope(a.accountId);
    expect(await repo.getScheduleRun(other, r!.id)).toBeNull();

    await repo.finishScheduleRun(r!.id, { status: 'done', title: 'T' });
    expect((await repo.listScheduleRuns(a, x.id, 5)).map((y) => y.status)).toEqual(['done']);
    expect(await repo.deleteSchedule(a, x.id)).toBe(true);
    expect(await repo.getScheduleRun(a, r!.id)).toBeNull();
  });

  it('claims due schedules once, then saves the state and clears the lease', async () => {
    const repo = new InMemoryAssistantRepository();
    const a = scope();
    const due = await repo.createSchedule(a, draft());
    await repo.createSchedule(a, draft({ status: 'paused', pausedReason: 'owner' }));
    const future = await repo.createSchedule(
      a,
      draft({ nextRunAt: new Date(Date.now() + 3_600_000) }),
    );
    await repo.updateSchedule(a, future.id, { runRequestedAt: new Date() });
    const now = new Date();
    const first = await repo.claimDueSchedules(now, 10, 300_000);
    expect(first.map((x) => x.id).sort()).toEqual([due.id, future.id].sort());
    expect(await repo.claimDueSchedules(now, 10, 300_000)).toEqual([]);
    // A lapsed lease makes it claimable again.
    const lapsed = await repo.claimDueSchedules(new Date(now.getTime() + 301_000), 10, 300_000);
    expect(lapsed).toHaveLength(2);

    const claimed = first.find((x) => x.id === future.id)!;
    await repo.saveScheduleState(
      future.id,
      { lastRunAt: now },
      { runRequestedAt: claimed.runRequestedAt, advanceFrom: null },
    );
    const saved = await repo.getSchedule(a, future.id);
    expect(saved?.leaseUntil).toBeNull();
    expect(saved?.runRequestedAt).toBeNull();
    expect(saved?.nextRunAt).toEqual(future.nextRunAt);
  });

  it('keeps a run request and a cadence edit made during the lease', async () => {
    const repo = new InMemoryAssistantRepository();
    const a = scope();
    const s = await repo.createSchedule(a, draft());
    await repo.updateSchedule(a, s.id, { runRequestedAt: new Date(Date.now() - 60_000) });
    const now = new Date();
    const [claimed] = await repo.claimDueSchedules(now, 10, 300_000);
    // During the lease: a new "run now" and a weekly cadence.
    const again = new Date(now.getTime() + 1_000);
    await repo.updateSchedule(a, s.id, {
      runRequestedAt: again,
      cadence: { kind: 'weekly', days: [1], at: '08:00' },
    });
    await repo.saveScheduleState(
      s.id,
      { lastRunAt: now },
      { runRequestedAt: claimed!.runRequestedAt, advanceFrom: now },
    );
    const saved = repo.schedules.get(s.id)!;
    expect(saved.runRequestedAt).toEqual(again);
    expect(saved.cadence).toEqual({ kind: 'weekly', days: [1], at: '08:00' });
    // The next run follows the weekly cadence (a Monday, 08:00 local = 01:00Z).
    expect(saved.nextRunAt!.getUTCDay()).toBe(1);
    expect(saved.nextRunAt!.toISOString().slice(11)).toBe('01:00:00.000Z');
    expect(saved.leaseUntil).toBeNull();
  });

  it('does not pause or reschedule a schedule the owner paused during the lease', async () => {
    const repo = new InMemoryAssistantRepository();
    const a = scope();
    const s = await repo.createSchedule(a, draft());
    const now = new Date();
    await repo.claimDueSchedules(now, 10, 300_000);
    await repo.updateSchedule(a, s.id, {
      status: 'paused',
      pausedReason: 'owner',
      nextRunAt: null,
    });
    await repo.saveScheduleState(
      s.id,
      { consecutiveFailures: 3 },
      { runRequestedAt: null, advanceFrom: now, pause: 'failures' },
    );
    expect(repo.schedules.get(s.id)).toMatchObject({
      status: 'paused',
      pausedReason: 'owner',
      nextRunAt: null,
      consecutiveFailures: 3,
    });
  });

  it('counts pending schedule create proposals and purges old runs', async () => {
    const repo = new InMemoryAssistantRepository();
    const a = scope();
    const t = await repo.createThread(a, {
      id: newId(),
      title: 't',
      systemPrompt: 'p',
      promptVersion: 'v',
    });
    const base = {
      threadId: t.id,
      runId: null,
      businessId: BUSINESS,
      query: null,
      body: {},
      summary: 's',
      preview: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    };
    await repo.createProposal(a, {
      ...base,
      id: newId(),
      kind: 'schedule',
      routeKey: 'SCHEDULE create',
      path: '/assistant/schedules',
    });
    await repo.createProposal(a, {
      ...base,
      id: newId(),
      kind: 'schedule',
      routeKey: 'SCHEDULE create',
      path: '/assistant/schedules',
      expiresAt: new Date(Date.now() - 1000),
    });
    const route = await repo.createProposal(a, {
      ...base,
      id: newId(),
      routeKey: 'PATCH /x',
      path: '/x',
    });
    expect(route.kind).toBe('route');
    expect(await repo.countPendingScheduleProposals(a)).toBe(1);

    const x = await repo.createSchedule(a, draft());
    await repo.insertScheduleRun(run(a, x.id));
    expect(await repo.purgeOldScheduleRuns(new Date(Date.now() + 1000))).toBe(1);
  });
});
