import {
  createDb,
  type Database,
  ensureLoginRoles,
  migrate,
  sql,
  withCredentials,
  writeOutbox,
} from '@agent-sales/db';
import { newId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { blankSignal } from '../src/modules/brain/domain/signal.js';
import { DrizzleBrainStore } from '../src/modules/brain/infrastructure/persistence/brain.drizzle-store.js';
import { DrizzleMessageEventSource } from '../src/modules/brain/infrastructure/persistence/message-events.drizzle.js';

/**
 * The brain's Drizzle store and outbox reader on a real Postgres (migration 0073): the atomic
 * daily reservation, the job upsert/claim/lease, tenant isolation and the outbox window.
 */
let pg: TestPostgres;
let owner: { db: Database; close: () => Promise<void> };
let tenant: { db: Database; close: () => Promise<void> };
let system: { db: Database; close: () => Promise<void> };
let store: DrizzleBrainStore;

const user = newId();
const shops: { ws: ReturnType<typeof workspaceId>; conv: string }[] = [];
const exec = (q: ReturnType<typeof sql>) => owner.db.execute(q);

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  owner = createDb({ url: pg.ownerUrl, max: 2 });
  tenant = createDb({
    url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    max: 2,
  });
  system = createDb({
    url: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
    max: 2,
  });
  store = new DrizzleBrainStore(tenant.db, system.db);
  await exec(sql`insert into users (id, email, name) values (${user}, 'b@example.test', 'B')`);
  for (let i = 0; i < 2; i++) {
    const ws = newId();
    const channel = newId();
    const conv = newId();
    await exec(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id)
      values (${ws}, ${ws}, ${`Shop ${i}`}, 'retail', ${user})`);
    await exec(sql`insert into channel_connections (id, workspace_id, provider, external_id, name, token_sealed)
      values (${channel}, ${ws}, 'website', ${channel}, 'Site', 'sealed')`);
    await exec(sql`insert into conversations (id, workspace_id, channel_id, customer_id, data)
      values (${conv}, ${ws}, ${channel}, ${conv}, '{}'::jsonb)`);
    shops.push({ ws: workspaceId(ws), conv });
  }
}, 120_000);

afterAll(async () => {
  await system?.close();
  await tenant?.close();
  await owner?.close();
  await pg?.stop();
});

const T0 = new Date('2026-11-11T03:00:00.000Z');
const plus = (min: number) => new Date(T0.getTime() + min * 60_000);

describe('DrizzleBrainStore', () => {
  it('reserves evaluations atomically up to the limit and releases them', async () => {
    const [a] = shops;
    if (!a) throw new Error('setup');
    const day = '2026-11-11';
    const results = await Promise.all(
      Array.from({ length: 5 }, () => store.reserveUsage(a.ws, day, 3)),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(await store.usedOn(a.ws, day)).toBe(3);
    await store.releaseUsage(a.ws, day);
    expect(await store.usedOn(a.ws, day)).toBe(2);
    expect(await store.reserveUsage(a.ws, '2026-11-12', 0)).toBe(false);
    expect(await store.reserveUsage(a.ws, day, null)).toBe(true);
  });

  it('upserts jobs with the later run, claims them once with a lease and drops them', async () => {
    const [a] = shops;
    if (!a) throw new Error('setup');
    await store.scheduleJob(a.ws, a.conv, plus(45));
    await store.scheduleJob(a.ws, a.conv, plus(10));
    expect(await store.claimDueJobs(plus(44), 5, 120_000)).toHaveLength(0);
    const [job, ...rest] = await store.claimDueJobs(plus(46), 5, 120_000);
    expect(rest).toHaveLength(0);
    expect(job).toMatchObject({ workspaceId: a.ws, conversationId: a.conv, attempts: 1 });
    expect(job?.runAfter).toEqual(plus(45));
    expect(await store.claimDueJobs(plus(47), 5, 120_000)).toHaveLength(0);
    // A newer message while it ran keeps the job.
    await store.scheduleJob(a.ws, a.conv, plus(90));
    await store.finishJob(a.ws, a.conv, plus(45));
    expect(await store.claimDueJobs(plus(91), 5, 120_000)).toHaveLength(1);
    await store.finishJob(a.ws, a.conv, plus(90));
    expect(await store.claimDueJobs(plus(200), 5, 120_000)).toHaveLength(0);
  });

  it('caps a job until the next day and resets it then', async () => {
    const [a] = shops;
    if (!a) throw new Error('setup');
    await store.scheduleJob(a.ws, a.conv, T0);
    await store.capJob(a.ws, a.conv, plus(600));
    expect(await store.resetCappedJobs(plus(10), plus(15))).toBe(0);
    expect(await store.claimDueJobs(plus(10), 5, 120_000)).toHaveLength(0);
    // Back in line a few minutes after the reset, behind the jobs due already.
    expect(await store.resetCappedJobs(plus(600), plus(605))).toBe(1);
    expect(await store.claimDueJobs(plus(601), 5, 120_000)).toHaveLength(0);
    const [job] = await store.claimDueJobs(plus(605), 5, 120_000);
    expect(job).toMatchObject({ runAfter: plus(605), attempts: 1 });
    await store.finishJob(a.ws, a.conv, plus(605));
  });

  it('ignores a job for a conversation that no longer exists', async () => {
    const [a] = shops;
    if (!a) throw new Error('setup');
    await expect(store.scheduleJob(a.ws, newId(), T0)).resolves.toBeUndefined();
  });

  it('keeps signals and settings per business', async () => {
    const [a, b] = shops;
    if (!a || !b) throw new Error('setup');
    await store.saveEvaluation(a.ws, { ...blankSignal(a.conv, null, T0), stage: 'ready' }, null);
    expect((await store.getSignal(a.ws, a.conv))?.stage).toBe('ready');
    expect(await store.getSignal(b.ws, a.conv)).toBeNull();
    expect(await store.signalsFor(b.ws, [a.conv])).toEqual([]);
    await store.putSettings(a.ws, {
      mode: 'manual',
      idleMinutes: 60,
      briefingEnabled: false,
      briefingHour: 7,
    });
    expect((await store.getSettings(a.ws))?.mode).toBe('manual');
    expect(await store.getSettings(b.ws)).toBeNull();
    await store.recordRun(a.ws, {
      conversationId: a.conv,
      trigger: 'manual',
      tier: 'basic',
      model: 'm',
      inputTokens: 1,
      outputTokens: 2,
      outcome: 'ok',
    });
    await store.recordRun(a.ws, {
      conversationId: a.conv,
      trigger: 'draft',
      tier: 'basic',
      model: 'm',
      inputTokens: 1,
      outputTokens: 2,
      outcome: 'ok',
    });
  });

  it("keeps a member's lock, stage and dismissal written while an evaluation ran", async () => {
    const [, b] = shops;
    if (!b) throw new Error('setup');
    // The evaluation read no row; meanwhile a member locks the stage and dismisses.
    const evaluated = {
      ...blankSignal(b.conv, null, T0),
      stage: 'exploring' as const,
      note: 'Khách hỏi size',
      evaluatedAt: plus(1),
      evaluatedUntil: T0,
    };
    await store.saveStage(b.ws, b.conv, null, { stage: 'won', stageLocked: true }, plus(0.5));
    await store.dismissSignal(b.ws, b.conv, null, plus(0.6));
    const saved = await store.saveEvaluation(b.ws, evaluated, T0);
    expect(saved).toMatchObject({
      stage: 'won',
      stageLocked: true,
      note: 'Khách hỏi size',
      dismissedUntilMessageAfter: plus(0.6),
      version: 3,
    });
    // Unlocked, the next evaluation sets the stage; a newer customer message clears the dismissal.
    const unlocked = await store.saveStage(
      b.ws,
      b.conv,
      null,
      { stage: null, stageLocked: false },
      plus(2),
    );
    expect(unlocked).toMatchObject({ stage: 'won', stageLocked: false, version: 4 });
    const next = await store.saveEvaluation(b.ws, { ...evaluated, stage: 'ready' }, plus(3));
    expect(next).toMatchObject({ stage: 'ready', dismissedUntilMessageAfter: null, version: 5 });
    // A racing evaluation that covered less never moves evaluated_until back.
    await store.saveEvaluation(b.ws, { ...evaluated, evaluatedUntil: plus(10) }, null);
    const older = await store.saveEvaluation(b.ws, { ...evaluated, evaluatedUntil: plus(5) }, null);
    expect(older.evaluatedUntil).toEqual(plus(10));
    // Undo a dismiss clears it.
    await store.dismissSignal(b.ws, b.conv, null, plus(11));
    await store.undismissSignal(b.ws, b.conv, plus(12));
    expect((await store.getSignal(b.ws, b.conv))?.dismissedUntilMessageAfter).toBeNull();
  });

  it('lists Today signal refs with the ageing bounds and the attention flag', async () => {
    const [a] = shops;
    if (!a) throw new Error('setup');
    const q = (now: Date) =>
      store.todaySignalRefs(a.ws, {
        now,
        readySince: new Date(now.getTime() - 7 * 86_400_000),
        priceSince: new Date(now.getTime() - 14 * 86_400_000),
        limit: 10,
      });
    await store.saveEvaluation(
      a.ws,
      { ...blankSignal(a.conv, null, T0), stage: 'ready', evaluatedAt: T0, evaluatedUntil: T0 },
      null,
    );
    expect(await q(plus(60))).toEqual([{ conversationId: a.conv, attention: false }]);
    expect(await q(new Date(T0.getTime() + 8 * 86_400_000))).toEqual([]);
    await store.saveEvaluation(
      a.ws,
      { ...blankSignal(a.conv, null, T0), stage: 'ready', mood: 'complaint', evaluatedAt: T0 },
      null,
    );
    expect(await q(new Date(T0.getTime() + 8 * 86_400_000))).toEqual([
      { conversationId: a.conv, attention: true },
    ]);
  });
});

describe('DrizzleMessageEventSource', () => {
  it('starts at the current horizon, then reads only new customer-message events', async () => {
    const [a] = shops;
    if (!a) throw new Error('setup');
    const source = new DrizzleMessageEventSource(system.db);
    const emit = (type: string) =>
      owner.db.transaction((tx) =>
        writeOutbox(tx, {
          workspaceId: a.ws,
          type,
          aggregateType: 'conversation',
          aggregateId: a.conv,
          payload: { messageId: newId(), type: 'message' },
        }),
      );
    await emit('conversation.message.received.v1');
    const read = () =>
      source.withLease(async (lease) => {
        const rows = await lease.readBatch(0, 100);
        await lease.commit();
        return rows;
      });
    // First pass: history is skipped.
    expect(await read()).toEqual([]);
    await emit('conversation.message.received.v1');
    await emit('conversation.reply.completed.v1');
    const rows = await read();
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({ workspaceId: a.ws, conversationId: a.conv });
    expect(await read()).toEqual([]);
    // Its position is its own table's row, not the analytics projector's.
    const own = await exec(sql`select consumer from brain_checkpoints`);
    expect([...own]).toEqual([{ consumer: 'brain.signals' }]);
    const analytics = await exec(
      sql`select 1 from analytics_checkpoints where consumer = 'brain.signals'`,
    );
    expect([...analytics]).toEqual([]);
  });
});
