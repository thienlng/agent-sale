import {
  createDb,
  ensureLoginRoles,
  migrate,
  schema,
  withCredentials,
  withSystem,
  type Database,
} from '@agent-sales/db';
import { newId, userId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { OwnerScope } from '../src/modules/assistant/domain/owner-scope.js';
import type { NewSchedule } from '../src/modules/assistant/domain/ports/assistant.repository.js';
import { DrizzleAssistantRepository } from '../src/modules/assistant/infrastructure/persistence/assistant.drizzle-repository.js';
import type { NewNotification } from '../src/modules/notification/domain/ports/notification.repository.js';
import { DrizzleNotificationRepository } from '../src/modules/notification/infrastructure/persistence/notification.drizzle-repository.js';

/**
 * Schedules and notifications on Postgres (0060, T-172) through the Drizzle repositories:
 * owner isolation, the leased schedule claim under concurrency, the unique run slot, the
 * notification dedup key, the keyset list and the delivery claim. Two repositories on two
 * system connections stand for two worker processes.
 */
let pg: TestPostgres;
const handles: { db: Database; close: () => Promise<void> }[] = [];
let repo: DrizzleAssistantRepository;
let repo2: DrizzleAssistantRepository;
let notes: DrizzleNotificationRepository;
let notes2: DrizzleNotificationRepository;
let system: Database;

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  const tenantUrl = withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password);
  const systemUrl = withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password);
  const open = (url: string) => {
    const h = createDb({ url, max: 1 });
    handles.push(h);
    return h.db;
  };
  const tenant = open(tenantUrl);
  system = open(systemUrl);
  repo = new DrizzleAssistantRepository(tenant, system);
  notes = new DrizzleNotificationRepository(tenant, system);
  const tenant2 = open(tenantUrl);
  const system2 = open(systemUrl);
  repo2 = new DrizzleAssistantRepository(tenant2, system2);
  notes2 = new DrizzleNotificationRepository(tenant2, system2);
});

afterAll(async () => {
  await Promise.all(handles.map((h) => h.close()));
  await pg?.stop();
});

async function owner(): Promise<OwnerScope> {
  const account = newId();
  const user = userId(newId());
  const business = workspaceId(newId());
  await withSystem(system, async (tx) => {
    await tx.insert(schema.users).values({ id: user, email: `${user}@example.test`, name: 'O' });
    await tx.insert(schema.accounts).values({ id: account, name: 'acc', createdByUserId: user });
    await tx.insert(schema.workspaces).values({
      id: business,
      workspaceId: business,
      name: 'Shop',
      industry: 'fashion',
      ownerUserId: user,
      accountId: account,
    });
  });
  return { accountId: account, ownerUserId: user, businessId: business, businessIds: [business] };
}

const draft = (s: OwnerScope, over: Partial<NewSchedule> = {}): NewSchedule => ({
  id: newId(),
  businessId: s.businessId,
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

const note = (s: OwnerScope, over: Partial<NewNotification> = {}): NewNotification => ({
  id: newId(),
  accountId: s.accountId,
  userId: s.ownerUserId,
  workspaceId: s.businessId,
  type: 'assistant.report',
  params: {},
  title: 'Doanh thu hôm qua',
  body: '1.250.000 ₫',
  target: { kind: 'path', path: '/app/orders' },
  dedupKey: null,
  ...over,
});

describe('assistant schedules on Postgres (T-172)', () => {
  it('keeps schedules and runs per owner', async () => {
    const a = await owner();
    const b = await owner();
    const sa = await repo.createSchedule(a, draft(a));
    expect(sa.status).toBe('active');
    expect(await repo.countSchedules(a)).toBe(1);
    expect(await repo.getSchedule(b, sa.id)).toBeNull();
    expect(await repo.getSchedule({ ...b, ownerUserId: a.ownerUserId }, sa.id)).toBeNull();
    expect(await repo.listSchedules(b)).toEqual([]);
    expect(await repo.updateSchedule(b, sa.id, { name: 'x' })).toBeNull();
    expect(await repo.deleteSchedule(b, sa.id)).toBe(false);

    const updated = await repo.updateSchedule(a, sa.id, { name: 'Mới' }, sa.updatedAt);
    expect(updated?.name).toBe('Mới');
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(sa.updatedAt.getTime());
    // A stale token changes nothing.
    expect(await repo.updateSchedule(a, sa.id, { name: 'Cũ' }, sa.updatedAt)).toBeNull();

    const run = await repo.insertScheduleRun({
      id: newId(),
      accountId: a.accountId,
      ownerUserId: a.ownerUserId,
      scheduleId: sa.id,
      trigger: 'manual',
      scheduledFor: new Date('2026-11-02T01:00:00Z'),
    });
    expect(run?.status).toBe('running');
    expect(await repo.getScheduleRun(b, run!.id)).toBeNull();
    expect(await repo.listScheduleRuns(b, sa.id, 10)).toEqual([]);
    expect((await repo.listScheduleRuns(a, sa.id, 10)).map((r) => r.id)).toEqual([run!.id]);

    await repo.finishScheduleRun(run!.id, {
      status: 'done',
      title: 'T',
      body: 'B',
      report: { template: 'revenue_summary' },
      finishedAt: new Date(),
    });
    expect((await repo.getScheduleRun(a, run!.id))?.status).toBe('done');

    expect(await repo.deleteSchedule(a, sa.id)).toBe(true);
    expect(await repo.getScheduleRun(a, run!.id)).toBeNull();
  });

  it('sets a run thread once', async () => {
    const a = await owner();
    const s = await repo.createSchedule(a, draft(a));
    const run = await repo.insertScheduleRun({
      id: newId(),
      accountId: a.accountId,
      ownerUserId: a.ownerUserId,
      scheduleId: s.id,
      trigger: 'cadence',
      scheduledFor: new Date('2026-11-02T01:00:00Z'),
    });
    const t1 = await repo.createThread(a, {
      id: newId(),
      title: 'Báo cáo',
      systemPrompt: 'p',
      promptVersion: 'v1',
      origin: 'schedule',
    });
    const t2 = await repo.createThread(a, {
      id: newId(),
      title: 'Báo cáo',
      systemPrompt: 'p',
      promptVersion: 'v1',
      origin: 'schedule',
    });
    expect(await repo.setRunThread(a, run!.id, t1.id)).toBe(t1.id);
    expect(await repo.setRunThread(a, run!.id, t2.id)).toBe(t1.id);
    const b = await owner();
    const tb = await repo.createThread(b, {
      id: newId(),
      title: 'x',
      systemPrompt: 'p',
      promptVersion: 'v1',
    });
    expect(await repo.setRunThread(b, run!.id, tb.id)).toBeNull();
  });

  it('allows one run per slot', async () => {
    const a = await owner();
    const s = await repo.createSchedule(a, draft(a));
    const slot = new Date('2026-11-02T01:00:00Z');
    const row = () => ({
      id: newId(),
      accountId: a.accountId,
      ownerUserId: a.ownerUserId,
      scheduleId: s.id,
      trigger: 'cadence' as const,
      scheduledFor: slot,
    });
    const [x, y] = await Promise.all([
      repo.insertScheduleRun(row()),
      repo2.insertScheduleRun(row()),
    ]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
    // The runner finds the slot's run again (resuming a crashed worker's run).
    expect((await repo.getScheduleRunAt(s.id, slot))?.id).toBe((x ?? y)!.id);
    expect(await repo.getScheduleRunAt(s.id, new Date(slot.getTime() + 1))).toBeNull();
  });

  it('gives two concurrent claimers disjoint schedules and honours the lease', async () => {
    const owners = await Promise.all([owner(), owner(), owner()]);
    const ids = new Set<string>();
    for (const o of owners) {
      for (let i = 0; i < 3; i++) ids.add((await repo.createSchedule(o, draft(o))).id);
    }
    // Paused, future and manually requested rows.
    const o = owners[0]!;
    await repo.createSchedule(o, draft(o, { status: 'paused', pausedReason: 'owner' }));
    await repo.createSchedule(o, draft(o, { nextRunAt: new Date(Date.now() + 3_600_000) }));
    const requested = await repo.createSchedule(
      o,
      draft(o, { nextRunAt: new Date(Date.now() + 3_600_000) }),
    );
    await repo.updateSchedule(o, requested.id, { runRequestedAt: new Date() });
    ids.add(requested.id);

    const now = new Date();
    const [c1, c2] = await Promise.all([
      repo.claimDueSchedules(now, 50, 300_000),
      repo2.claimDueSchedules(now, 50, 300_000),
    ]);
    // Other tests' due rows may be claimed too; ours are each claimed exactly once.
    const got = [...c1, ...c2].map((x) => x.id);
    expect(new Set(got).size).toBe(got.length);
    expect(new Set(got.filter((id) => ids.has(id)))).toEqual(ids);
    expect([...c1, ...c2].every((x) => x.leaseUntil && x.accountId && x.ownerUserId)).toBe(true);
    // Leased: nothing of ours is claimed again.
    const again = await repo.claimDueSchedules(now, 50, 300_000);
    expect(again.filter((x) => ids.has(x.id))).toEqual([]);

    // Saving the state clears the lease; the row is due again only when its time comes.
    await repo.saveScheduleState(requested.id, {
      runRequestedAt: null,
      lastRunAt: now,
      nextRunAt: new Date(Date.now() + 3_600_000),
    });
    const later = await repo.claimDueSchedules(new Date(), 50, 300_000);
    expect(later.map((x) => x.id)).not.toContain(requested.id);
    const saved = await repo.getSchedule(o, requested.id);
    expect(saved?.leaseUntil).toBeNull();
    expect(saved?.runRequestedAt).toBeNull();
  });

  it('counts only pending, unexpired schedule create proposals', async () => {
    const a = await owner();
    const thread = await repo.createThread(a, {
      id: newId(),
      title: 't',
      systemPrompt: 'p',
      promptVersion: 'v1',
    });
    const base = {
      threadId: thread.id,
      runId: null,
      businessId: a.businessId,
      query: null,
      body: {},
      summary: 'Lịch báo cáo',
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
      routeKey: 'SCHEDULE remove',
      path: '/assistant/schedules/x',
    });
    const route = await repo.createProposal(a, {
      ...base,
      id: newId(),
      routeKey: 'PATCH /products/{productId}',
      path: '/products/p',
    });
    expect(route.kind).toBe('route');
    expect(await repo.countPendingScheduleProposals(a)).toBe(1);
  });

  it('purges old runs', async () => {
    const a = await owner();
    const s = await repo.createSchedule(a, draft(a));
    await repo.insertScheduleRun({
      id: newId(),
      accountId: a.accountId,
      ownerUserId: a.ownerUserId,
      scheduleId: s.id,
      trigger: 'cadence',
      scheduledFor: new Date('2026-01-01T01:00:00Z'),
    });
    expect(await repo.purgeOldScheduleRuns(new Date(Date.now() + 1000))).toBeGreaterThanOrEqual(1);
    expect(await repo.listScheduleRuns(a, s.id, 10)).toEqual([]);
  });
});

describe('notifications on Postgres (T-172)', () => {
  it('dedups per user and stores the deliveries in the same call', async () => {
    const a = await owner();
    const key = `sched:${newId()}:2026-11-02T01:00:00.000Z`;
    const first = await notes.insertNotification(note(a, { dedupKey: key }), [
      { id: newId(), channel: 'email' },
      { id: newId(), channel: 'push', status: 'skipped', errorCode: 'channel_unavailable' },
    ]);
    expect(first.deduped).toBe(false);
    expect(first.deliveries.map((x) => [x.channel, x.status])).toEqual(
      expect.arrayContaining([
        ['email', 'queued'],
        ['push', 'skipped'],
      ]),
    );
    const again = await notes2.insertNotification(note(a, { dedupKey: key }), [
      { id: newId(), channel: 'email' },
    ]);
    expect(again).toEqual({ id: first.id, deduped: true, deliveries: [] });
    const summary = await notes.deliverySummary(a.accountId, a.ownerUserId, [first.id]);
    expect(summary.get(first.id)).toEqual({ email: 'queued', push: 'skipped' });
  });

  it('lists by keyset, counts unread and marks read for the user only', async () => {
    const a = await owner();
    const b = await owner();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push((await notes.insertNotification(note(a, { title: `n${i}` }), [])).id);
    }
    await notes.insertNotification(note(b), []);
    const page1 = await notes.list(a.accountId, a.ownerUserId, { limit: 2 });
    expect(page1.map((x) => x.title)).toEqual(['n4', 'n3']);
    const last = page1[1]!;
    const page2 = await notes.list(a.accountId, a.ownerUserId, {
      limit: 10,
      before: last.createdAt,
      beforeId: last.id,
    });
    expect(page2.map((x) => x.title)).toEqual(['n2', 'n1', 'n0']);
    expect(await notes.unreadCount(a.accountId, a.ownerUserId)).toBe(5);

    // Another user (same id under another account, or another account's id) sees nothing.
    expect(await notes.markRead(b.accountId, b.ownerUserId, ids[0]!)).toBeNull();
    expect(await notes.markRead(b.accountId, a.ownerUserId, ids[0]!)).toBeNull();
    expect(await notes.list(b.accountId, a.ownerUserId, { limit: 10 })).toEqual([]);

    const read = await notes.markRead(a.accountId, a.ownerUserId, ids[0]!);
    expect(read?.readAt).toBeInstanceOf(Date);
    expect(await notes.unreadCount(a.accountId, a.ownerUserId)).toBe(4);
    expect(await notes.markAllRead(a.accountId, a.ownerUserId)).toBe(4);
    expect(await notes.unreadCount(a.accountId, a.ownerUserId)).toBe(0);
    expect(await notes.unreadCount(b.accountId, b.ownerUserId)).toBe(1);
  });

  it('claims due deliveries once, skips leased ones and reclaims a lapsed lease', async () => {
    const a = await owner();
    const made = await notes.insertNotification(note(a), [{ id: newId(), channel: 'email' }]);
    const deliveryId = made.deliveries[0]!.id;
    const now = new Date(Date.now() + 1000);
    const [c1, c2] = await Promise.all([
      notes.claimDeliveries(now, 50, 120_000),
      notes2.claimDeliveries(now, 50, 120_000),
    ]);
    const mine = [...c1, ...c2].filter((x) => x.id === deliveryId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.status).toBe('sending');
    // Leased: not claimed again before the lease lapses.
    const soon = await notes.claimDeliveries(new Date(now.getTime() + 60_000), 50, 120_000);
    expect(soon.map((x) => x.id)).not.toContain(deliveryId);
    const lapsed = await notes.claimDeliveries(new Date(now.getTime() + 121_000), 50, 120_000);
    expect(lapsed.map((x) => x.id)).toContain(deliveryId);

    const sentAt = new Date();
    await notes.finishDelivery(deliveryId, {
      status: 'sent',
      attempts: 1,
      sentAt,
      providerMessageId: 'm1',
    });
    expect(await notes.countSentEmails(a.ownerUserId, new Date(sentAt.getTime() - 1000))).toBe(1);
    const summary = await notes.deliverySummary(a.accountId, a.ownerUserId, [made.id]);
    expect(summary.get(made.id)).toEqual({ email: 'sent' });
    expect(await notes.purgeOld(new Date(Date.now() + 5000))).toBeGreaterThanOrEqual(1);
    expect(await notes.list(a.accountId, a.ownerUserId, { limit: 10 })).toEqual([]);
  });
});
