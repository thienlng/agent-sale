import { newId, userId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withAccount } from './account.js';
import { createDb, type Database } from './client.js';
import { ensureLoginRoles, migrate, withCredentials } from './migrate.js';
import {
  accounts,
  assistantProposals,
  assistantScheduleRuns,
  assistantSchedules,
  assistantThreads,
  notificationDeliveries,
  notifications,
  users,
  workspaces,
} from './schema/index.js';
import { withSystem } from './tenant.js';

/**
 * Schedules and notifications (0060, T-172): account RLS on the four new tables, their CHECK
 * constraints, the unique run slot, the per-user dedup key and the proposal `kind` column.
 * One connection per client (`max: 1`) mimics PgBouncer.
 */
let pg: TestPostgres;
let tenantDb: { db: Database; close: () => Promise<void> };
let systemDb: { db: Database; close: () => Promise<void> };
type Fixture = { account: string; owner: string; business: string; thread: string };
const fixtures: Fixture[] = [];

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  tenantDb = createDb({
    url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    max: 1,
  });
  systemDb = createDb({
    url: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
    max: 1,
  });
  for (let i = 0; i < 2; i++) {
    const f = { account: newId(), owner: userId(newId()), business: newId(), thread: newId() };
    await withSystem(systemDb.db, async (tx) => {
      await tx.insert(users).values({ id: f.owner, email: `${f.owner}@example.test`, name: 'O' });
      await tx
        .insert(accounts)
        .values({ id: f.account, name: `acc-${i}`, createdByUserId: f.owner });
      await tx.insert(workspaces).values({
        id: f.business,
        workspaceId: f.business,
        name: `Shop ${i}`,
        industry: 'fashion',
        ownerUserId: f.owner,
        accountId: f.account,
      });
      await tx.insert(assistantThreads).values({
        id: f.thread,
        accountId: f.account,
        ownerUserId: f.owner,
        systemPrompt: 'p',
        promptVersion: 'v1',
      });
    });
    fixtures.push(f);
  }
});

afterAll(async () => {
  await Promise.all([tenantDb?.close(), systemDb?.close()]);
  await pg?.stop();
});

const pair = () => fixtures as [Fixture, Fixture];

const scheduleRow = (f: Fixture, over: Partial<typeof assistantSchedules.$inferInsert> = {}) => ({
  id: newId(),
  accountId: f.account,
  ownerUserId: f.owner,
  businessId: f.business,
  name: 'Doanh thu hôm qua',
  template: 'revenue_summary',
  mode: 'report',
  params: { period: 'day', window: 'previous' },
  cadence: { kind: 'daily', at: '08:00' },
  channels: ['in_app'],
  createdBy: 'owner',
  nextRunAt: new Date(),
  ...over,
});

const notificationRow = (f: Fixture, over: Partial<typeof notifications.$inferInsert> = {}) => ({
  id: newId(),
  accountId: f.account,
  userId: f.owner,
  workspaceId: f.business,
  type: 'assistant.report',
  title: 'Doanh thu',
  body: '1.250.000 ₫',
  ...over,
});

describe('schedules and notifications tables (0060)', () => {
  it('isolates all four tables per account and hides them outside withAccount', async () => {
    const [a, b] = pair();
    for (const f of [a, b]) {
      await withAccount(tenantDb.db, f.account, async (tx) => {
        const s = scheduleRow(f);
        await tx.insert(assistantSchedules).values(s);
        await tx.insert(assistantScheduleRuns).values({
          id: newId(),
          accountId: f.account,
          ownerUserId: f.owner,
          scheduleId: s.id,
          trigger: 'cadence',
          scheduledFor: new Date(),
        });
        const n = notificationRow(f);
        await tx.insert(notifications).values(n);
        await tx.insert(notificationDeliveries).values({
          id: newId(),
          accountId: f.account,
          userId: f.owner,
          notificationId: n.id,
          channel: 'email',
        });
      });
    }
    const tables = [
      assistantSchedules,
      assistantScheduleRuns,
      notifications,
      notificationDeliveries,
    ] as const;
    for (const f of [a, b]) {
      for (const table of tables) {
        const rows = await withAccount(tenantDb.db, f.account, (tx) =>
          tx.select({ accountId: table.accountId }).from(table),
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.accountId === f.account)).toBe(true);
      }
    }
    // A tenant query outside withAccount (no app.account_id) sees nothing.
    for (const table of tables) {
      const rows = await tenantDb.db.select({ id: table.id }).from(table);
      expect(rows).toEqual([]);
    }
    // A write naming another account is refused.
    await expect(
      withAccount(tenantDb.db, a.account, (tx) =>
        tx.insert(notifications).values(notificationRow(b)),
      ),
    ).rejects.toThrow();
    await expect(
      withAccount(tenantDb.db, a.account, (tx) =>
        tx.insert(assistantSchedules).values(scheduleRow(b)),
      ),
    ).rejects.toThrow();
  });

  it('checks the channel set, the mode/template matrix and the name length', async () => {
    const [a] = pair();
    const insert = (over: Partial<typeof assistantSchedules.$inferInsert>) =>
      withAccount(tenantDb.db, a.account, (tx) =>
        tx.insert(assistantSchedules).values(scheduleRow(a, over)),
      );
    await expect(insert({ channels: ['email'] })).rejects.toThrow();
    await expect(insert({ channels: ['in_app', 'sms'] })).rejects.toThrow();
    await expect(insert({ mode: 'alert', template: 'revenue_summary' })).rejects.toThrow();
    await expect(insert({ name: 'x'.repeat(81) })).rejects.toThrow();
    await expect(insert({ pausedReason: 'bored' })).rejects.toThrow();
    await expect(insert({ createdBy: 'robot' })).rejects.toThrow();
    await expect(
      insert({ mode: 'alert', template: 'low_stock', channels: ['in_app', 'email', 'push'] }),
    ).resolves.toBeDefined();
  });

  it('allows one run per schedule slot', async () => {
    const [a] = pair();
    const s = scheduleRow(a);
    const slot = new Date('2026-11-02T01:00:00Z');
    const run = () => ({
      id: newId(),
      accountId: a.account,
      ownerUserId: a.owner,
      scheduleId: s.id,
      trigger: 'cadence',
      scheduledFor: slot,
    });
    await withAccount(tenantDb.db, a.account, async (tx) => {
      await tx.insert(assistantSchedules).values(s);
      await tx.insert(assistantScheduleRuns).values(run());
    });
    const second = await withAccount(tenantDb.db, a.account, (tx) =>
      tx
        .insert(assistantScheduleRuns)
        .values(run())
        .onConflictDoNothing({
          target: [assistantScheduleRuns.scheduleId, assistantScheduleRuns.scheduledFor],
        })
        .returning({ id: assistantScheduleRuns.id }),
    );
    expect(second).toEqual([]);
  });

  it('keeps a dedup key unique per user and channels unique per notification', async () => {
    const [a] = pair();
    const key = `sched:${newId()}:2026-11-02T01:00:00.000Z`;
    const first = notificationRow(a, { dedupKey: key });
    await withAccount(tenantDb.db, a.account, (tx) => tx.insert(notifications).values(first));
    await expect(
      withAccount(tenantDb.db, a.account, (tx) =>
        tx.insert(notifications).values(notificationRow(a, { dedupKey: key })),
      ),
    ).rejects.toThrow();
    // Without a key, any number of rows.
    await withAccount(tenantDb.db, a.account, async (tx) => {
      await tx.insert(notifications).values(notificationRow(a));
      await tx.insert(notifications).values(notificationRow(a));
    });
    const delivery = () => ({
      id: newId(),
      accountId: a.account,
      userId: a.owner,
      notificationId: first.id,
      channel: 'email',
    });
    await withAccount(tenantDb.db, a.account, (tx) =>
      tx.insert(notificationDeliveries).values(delivery()),
    );
    await expect(
      withAccount(tenantDb.db, a.account, (tx) =>
        tx.insert(notificationDeliveries).values(delivery()),
      ),
    ).rejects.toThrow();
    await expect(
      withAccount(tenantDb.db, a.account, (tx) =>
        tx.insert(notifications).values(notificationRow(a, { title: 't'.repeat(161) })),
      ),
    ).rejects.toThrow();
  });

  it("gives proposals a kind that defaults to 'route'", async () => {
    const [a] = pair();
    const base = {
      accountId: a.account,
      ownerUserId: a.owner,
      threadId: a.thread,
      businessId: a.business,
      routeKey: 'SCHEDULE create',
      path: '/assistant/schedules',
      summary: 'Tạo lịch báo cáo',
      expiresAt: new Date(Date.now() + 86_400_000),
    };
    const [route] = await withAccount(tenantDb.db, a.account, (tx) =>
      tx
        .insert(assistantProposals)
        .values({ ...base, id: newId() })
        .returning({ kind: assistantProposals.kind }),
    );
    expect(route?.kind).toBe('route');
    const [schedule] = await withAccount(tenantDb.db, a.account, (tx) =>
      tx
        .insert(assistantProposals)
        .values({ ...base, id: newId(), kind: 'schedule' })
        .returning({ kind: assistantProposals.kind }),
    );
    expect(schedule?.kind).toBe('schedule');
    await expect(
      withAccount(tenantDb.db, a.account, (tx) =>
        tx.insert(assistantProposals).values({ ...base, id: newId(), kind: 'shell' }),
      ),
    ).rejects.toThrow();
    const [check] = await withSystem(systemDb.db, (tx) =>
      tx.execute<{ def: string }>(sql`
        select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'assistant_proposals_kind_check'`),
    );
    expect(check?.def).toContain('product_import');
  });
});
