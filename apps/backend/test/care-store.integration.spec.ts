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
import { DrizzleCareEventSource } from '../src/modules/care/infrastructure/persistence/care-events.drizzle.js';
import { DrizzleCareStore } from '../src/modules/care/infrastructure/persistence/care.drizzle-store.js';

/**
 * The care module's Drizzle store and outbox reader on a real Postgres (migration 0074): cycles
 * keyed by anchor, the leased claim, the daily counter, drafts (claim, expiry), tenant isolation
 * and the brain's `brain.signals.updated.v1` event read from the outbox.
 */
let pg: TestPostgres;
let owner: { db: Database; close: () => Promise<void> };
let tenant: { db: Database; close: () => Promise<void> };
let system: { db: Database; close: () => Promise<void> };
let store: DrizzleCareStore;

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
  store = new DrizzleCareStore(tenant.db, system.db);
  await exec(sql`insert into users (id, email, name) values (${user}, 'c@example.test', 'C')`);
  for (let i = 0; i < 2; i++) {
    const ws = newId();
    const channel = newId();
    const conv = newId();
    await exec(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id)
      values (${ws}, ${ws}, ${`Shop ${i}`}, 'retail', ${user})`);
    await exec(sql`insert into channel_connections (id, workspace_id, provider, external_id, name, token_sealed)
      values (${channel}, ${ws}, 'facebook', ${channel}, 'Page', 'sealed')`);
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
const plus = (h: number) => new Date(T0.getTime() + h * 3_600_000);

function shop(i: number) {
  const s = shops[i];
  if (!s) throw new Error('setup');
  return s;
}

describe('DrizzleCareStore', () => {
  it('starts a cycle once per anchor and restarts it for a newer customer message', async () => {
    const a = shop(0);
    const e = {
      conversationId: a.conv,
      template: 'silent' as const,
      anchorAt: T0,
      nextAt: plus(2),
    };
    expect(await store.enroll(a.ws, e, T0)).toBe(true);
    expect(await store.enroll(a.ws, e, T0)).toBe(false);
    await store.stopConversation(a.ws, a.conv, ['silent'], 'customer_replied', T0);
    // The same anchor never restarts a stopped cycle; a newer one does.
    expect(await store.enroll(a.ws, e, T0)).toBe(false);
    expect(await store.enroll(a.ws, { ...e, anchorAt: plus(1), nextAt: plus(3) }, T0)).toBe(true);
    const claimed = await store.claimDue(plus(3), 10, 120_000);
    expect(claimed).toMatchObject([
      { conversationId: a.conv, template: 'silent', step: 0, attempts: 1 },
    ]);
    // Leased: a second worker gets nothing until the lease runs out.
    expect(await store.claimDue(plus(3), 10, 120_000)).toEqual([]);
    const [job] = claimed;
    if (!job) throw new Error('claim');
    await store.advance(a.ws, job.id, 1, plus(22), plus(3));
    expect(await store.claimDue(plus(4), 10, 120_000)).toEqual([]);
    expect(await store.claimDue(plus(22), 10, 120_000)).toMatchObject([{ step: 1 }]);
    await store.finish(a.ws, job.id, plus(22));
    expect(await store.claimDue(plus(30), 10, 120_000)).toEqual([]);
  });

  it('counts the day atomically up to the limit', async () => {
    const a = shop(0);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => store.reserveUsage(a.ws, '2026-11-11', 2)),
    );
    expect(results.filter(Boolean)).toHaveLength(2);
    await store.releaseUsage(a.ws, '2026-11-11');
    expect(await store.usedOn(a.ws, '2026-11-11')).toBe(1);
    expect(await store.usedOn(shop(1).ws, '2026-11-11')).toBe(0);
  });

  it('keeps drafts per business, sends once, expires with the window', async () => {
    const [a, b] = [shop(0), shop(1)];
    const draft = (id: string, closes: Date) =>
      store.insertMessage(a.ws, {
        id,
        conversationId: a.conv,
        enrollmentId: null,
        template: 'silent',
        step: 0,
        level: 'suggest',
        text: 'Dạ còn ạ',
        status: 'draft',
        skipReason: null,
        windowClosesAt: closes,
        model: 'fake',
        inputTokens: 10,
        outputTokens: 5,
        createdAt: T0,
      });
    const first = newId();
    await draft(first, plus(24));
    const second = newId();
    await draft(second, plus(24));
    // A newer draft of the conversation replaces the older one.
    expect((await store.getMessage(a.ws, first))?.status).toBe('expired');
    expect((await store.drafts(a.ws, 10)).map((d) => d.id)).toEqual([second]);
    expect(await store.drafts(b.ws, 10)).toEqual([]);
    expect(await store.getMessage(b.ws, second)).toBeNull();
    expect(await store.claimDraft(b.ws, second, user, plus(1))).toBeNull();

    const claimed = await store.claimDraft(a.ws, second, user, plus(1));
    expect(claimed?.status).toBe('sending');
    expect(await store.claimDraft(a.ws, second, user, plus(1))).toBeNull();
    const sentId = newId();
    await store.finishSend(
      a.ws,
      second,
      { status: 'sent', text: 'Dạ vẫn còn ạ', sentMessageId: sentId, reason: null, actor: user },
      plus(1),
    );
    expect(await store.getMessage(a.ws, second)).toMatchObject({
      status: 'sent',
      text: 'Dạ vẫn còn ạ',
      sentMessageId: sentId,
      decidedBy: user,
    });
    expect(await store.sentTimes(a.ws, a.conv, T0)).toEqual([plus(1)]);
    expect((await store.sentBetween(a.ws, { since: T0, until: plus(2), limit: 10 })).length).toBe(
      1,
    );

    const late = newId();
    await draft(late, plus(24));
    expect(await store.expireDue(plus(25), plus(-100))).toBeGreaterThanOrEqual(1);
    expect((await store.getMessage(a.ws, late))?.status).toBe('expired');
    const audits = await exec(
      sql`select action, actor_name from audit_events where workspace_id = ${a.ws} order by created_at`,
    );
    expect(audits.map((r) => r.action)).toEqual(
      expect.arrayContaining(['care.message.drafted', 'care.message.sent']),
    );
  });

  it('lists due after-sales check-ins and stops them on a customer message', async () => {
    const b = shop(1);
    await store.enroll(
      b.ws,
      { conversationId: b.conv, template: 'after_sale', anchorAt: T0, nextAt: plus(72) },
      T0,
    );
    expect(await store.afterSaleDue(b.ws, plus(71), plus(70))).toEqual([]);
    expect(await store.afterSaleDue(b.ws, plus(80), plus(73))).toEqual([b.conv]);
    expect(await store.afterSaleDue(shop(0).ws, plus(80), plus(73))).toEqual([]);
    // After-sales cycles are never claimed by the message worker.
    expect((await store.claimDue(plus(100), 10, 1000)).map((j) => j.conversationId)).not.toContain(
      b.conv,
    );
    expect(
      await store.stopConversation(
        b.ws,
        b.conv,
        ['after_sale'],
        'customer_replied',
        plus(73),
        plus(73),
      ),
    ).toBe(1);
    expect(await store.afterSaleDue(b.ws, plus(80), plus(73))).toEqual([]);
  });
});

describe('care outbox reader and the brain event', () => {
  it('reads brain.signals.updated.v1 written with a signal, after the first horizon', async () => {
    const a = shop(0);
    const source = new DrizzleCareEventSource(system.db, ['brain.signals.updated.v1']);
    const read = () =>
      source.withLease(async (lease) => {
        const rows = await lease.readBatch(0, 100);
        await lease.commit();
        return rows;
      });
    expect(await read()).toEqual([]); // the first pass only sets the horizon
    const brain = new DrizzleBrainStore(tenant.db, system.db);
    const saved = await brain.saveEvaluation(
      a.ws,
      { ...blankSignal(a.conv, null, T0), stage: 'price_asked', optOut: true, evaluatedAt: T0 },
      T0,
    );
    expect(saved.optOut).toBe(true);
    await owner.db.transaction((tx) =>
      writeOutbox(tx, {
        workspaceId: a.ws,
        type: 'conversation.message.received.v1',
        aggregateType: 'conversation',
        aggregateId: a.conv,
        payload: {},
      }),
    );
    const rows = (await read()) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'brain.signals.updated.v1',
      aggregateId: a.conv,
      payload: { conversationId: a.conv, stage: 'price_asked', optOut: true, version: 1 },
    });
    expect(await read()).toEqual([]);
  });
});
