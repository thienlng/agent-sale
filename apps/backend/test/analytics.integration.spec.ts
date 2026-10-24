import { ContactDto, TagAssignmentDto, TagDto } from '@agent-sales/contracts';
import { and, asc, eq, schema, sql } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProjectorService } from '../src/modules/analytics/application/projector.service.js';
import { type Harness, startHarness } from './support/harness.js';

/** The statistics projection on a real Postgres (T-040): idempotence, late events, rebuild, gaps. */
let t: Harness;
let projector: ProjectorService;
beforeAll(async () => {
  t = await startHarness();
  projector = t.app.get(ProjectorService);
});
afterAll(async () => {
  await t?.stop();
});

const facts = async (ws: string) =>
  t.owner.db
    .select()
    .from(schema.analyticsFacts)
    .where(eq(schema.analyticsFacts.workspaceId, ws))
    .orderBy(asc(schema.analyticsFacts.outboxId), asc(schema.analyticsFacts.kind));
const kinds = async (ws: string) => (await facts(ws)).map((f) => f.kind);
const outboxCount = async () =>
  Number(
    (await t.owner.db.select({ n: sql<number>`count(*)` }).from(schema.outboxEvents))[0]?.n ?? 0,
  );

/** The golden shape of a fact: everything that must survive a rebuild (not the row id). */
const golden = async (ws: string) =>
  (await facts(ws)).map(({ id: _id, ...rest }) => ({ ...rest, occurredAt: +rest.occurredAt }));

describe('analytics projection', () => {
  it('projects customer, phone, owner, status and tag events', async () => {
    const lan = await t.user('lan@an.vn', 'Chủ shop Lan');
    const contact = ContactDto.parse(
      (
        await t.call(lan.h, 'POST', '/contacts', {
          name: 'Khách A',
          phone: '0901234567',
          salesUserId: lan.userId,
        })
      ).json(),
    );
    const tag = TagDto.parse(
      (await t.call(lan.h, 'POST', '/crm/tags', { name: 'VIP-AN', type: 'classification' })).json(),
    );
    const added = TagAssignmentDto.parse(
      (await t.call(lan.h, 'POST', `/contacts/${contact.id}/tags`, { tagId: tag.id })).json(),
    );
    await t.call(lan.h, 'POST', `/tag-assignments/${added.id}/remove`, { reason: 'nhầm' });
    const statuses = (await t.call(lan.h, 'GET', '/crm/statuses')).json() as {
      data: Array<{ id: string }>;
    };
    await t.call(lan.h, 'PATCH', `/contacts/${contact.id}`, {
      statusId: statuses.data[0]?.id,
      expectedVersion: 1,
    });

    expect(await projector.tick()).toBeGreaterThan(0);
    const got = await facts(lan.ownWorkspace);
    const k = got.map((f) => f.kind);
    expect(k).toEqual(
      expect.arrayContaining([
        'customer.created',
        'phone.captured',
        'assignment.changed',
        'tag.assigned',
        'tag.removed',
        'status.changed',
      ]),
    );
    const createdFact = got.find((f) => f.kind === 'customer.created');
    expect(createdFact).toMatchObject({ origin: 'manual', contactId: contact.id });
    // The tag add and remove are one assignment, an event each.
    const tagFacts = got.filter((f) => f.kind.startsWith('tag.'));
    expect(new Set(tagFacts.map((f) => f.refId)).size).toBe(1);
    // Nothing personal is kept: no column holds a name or phone number.
    expect(JSON.stringify(got)).not.toContain('0901234567');
    expect(JSON.stringify(got)).not.toContain('Khách A');
  });

  it('a replay or a duplicate delivery leaves the counts unchanged', async () => {
    const lan = await t.user('lan2@an.vn', 'Chủ shop');
    await t.call(lan.h, 'POST', '/contacts', { name: 'Khách B', phone: '0902222222' });
    await projector.tick();
    const before = await kinds(lan.ownWorkspace);
    expect(before.length).toBeGreaterThan(0);
    // Replay the whole outbox from the start.
    await t.owner.db.delete(schema.analyticsCheckpoints);
    await projector.tick();
    expect(await kinds(lan.ownWorkspace)).toEqual(before);
  });

  it('a late event lands in the day it happened, not the day it was processed', async () => {
    const lan = await t.user('lan3@an.vn', 'Chủ shop');
    const convo = crypto.randomUUID();
    const happened = new Date(Date.now() - 3 * 86_400_000);
    await t.owner.db.insert(schema.outboxEvents).values({
      workspaceId: lan.ownWorkspace,
      type: 'conversation.message.received.v1',
      aggregateType: 'conversation',
      aggregateId: convo,
      payload: {
        messageId: 'late-1',
        type: 'message',
        channelId: crypto.randomUUID(),
        occurredAt: happened.toISOString(),
        firstMessage: true,
      },
    });
    await projector.tick();
    const got = await facts(lan.ownWorkspace);
    expect(got.map((f) => f.kind).sort()).toEqual(['conversation.opened', 'message.inbound']);
    for (const f of got) {
      expect(f.occurredAt.toISOString()).toBe(happened.toISOString());
      expect(+f.receivedAt).toBeGreaterThan(+f.occurredAt + 2 * 86_400_000);
    }
  });

  it('rebuilding a workspace gives the same facts and sends nothing', async () => {
    const lan = await t.user('lan4@an.vn', 'Chủ shop');
    const c = ContactDto.parse(
      (await t.call(lan.h, 'POST', '/contacts', { name: 'Khách C', phone: '0903333333' })).json(),
    );
    const tag = TagDto.parse(
      (
        await t.call(lan.h, 'POST', '/crm/tags', { name: 'GOLD-AN', type: 'classification' })
      ).json(),
    );
    await t.call(lan.h, 'POST', `/contacts/${c.id}/tags`, { tagId: tag.id });
    await projector.tick();
    const before = await golden(lan.ownWorkspace);
    const outboxBefore = await outboxCount();

    const result = await projector.rebuild(lan.ownWorkspace as WorkspaceId);
    expect(result.facts).toBe(before.length);
    expect(await golden(lan.ownWorkspace)).toEqual(before);
    // Replay only reads the outbox and writes facts: no event was emitted, nothing to send.
    expect(await outboxCount()).toBe(outboxBefore);
  });

  it('a malformed event is dead-lettered and the projection moves on', async () => {
    const lan = await t.user('lan5@an.vn', 'Chủ shop');
    const [bad] = await t.owner.db
      .insert(schema.outboxEvents)
      .values({
        workspaceId: lan.ownWorkspace,
        type: 'crm.tag.assigned.v1',
        aggregateType: 'contact',
        aggregateId: crypto.randomUUID(),
        payload: { contactId: 'nope' },
      })
      .returning({ id: schema.outboxEvents.id });
    await t.call(lan.h, 'POST', '/contacts', { name: 'Khách D' });
    await projector.tick();
    const dead = await t.owner.db
      .select()
      .from(schema.analyticsDeadLetters)
      .where(eq(schema.analyticsDeadLetters.outboxId, bad?.id ?? 0));
    expect(dead).toHaveLength(1);
    expect(await kinds(lan.ownWorkspace)).toContain('customer.created');
  });

  it('reports where it is and how far behind, instead of hiding a gap', async () => {
    const lan = await t.user('lan6@an.vn', 'Chủ shop');
    await projector.catchUp();
    const idle = await projector.health();
    expect(idle.lagSeconds).toBe(0);
    expect(idle.watermarkId).toBeGreaterThan(0);

    await t.call(lan.h, 'POST', '/contacts', { name: 'Khách E' });
    const waiting = await projector.health();
    expect(waiting.watermarkId).toBe(idle.watermarkId);
    await projector.tick();
    const caught = await projector.health();
    expect(caught.watermarkId).toBeGreaterThan(idle.watermarkId);
    expect(caught.lagSeconds).toBe(0);
  });

  it('a rebuild reaches events of any age, and an old event does not count as lag', async () => {
    const lan = await t.user('lan11@an.vn', 'Chủ shop');
    await projector.catchUp();
    // Written by the oldest transaction there can be: a 32-bit `xmin` window could not tell it
    // apart from the future once the instance had run 2^31 transactions; a 64-bit id always can.
    await t.owner.db.insert(schema.outboxEvents).values({
      workspaceId: lan.ownWorkspace,
      type: 'conversation.message.received.v1',
      aggregateType: 'conversation',
      aggregateId: crypto.randomUUID(),
      payload: { messageId: 'ancient', type: 'message', firstMessage: false },
      txId: '3',
    });
    expect((await projector.health()).lagSeconds).toBe(0);
    await projector.rebuild(lan.ownWorkspace as WorkspaceId);
    expect(await kinds(lan.ownWorkspace)).toContain('message.inbound');
  });

  it('never skips an event whose transaction is still open when a higher id is already visible', async () => {
    const lan = await t.user('lan7@an.vn', 'Chủ shop');
    await projector.catchUp();
    const a = crypto.randomUUID();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let inserted!: () => void;
    const opened = new Promise<void>((r) => (inserted = r));

    // Transaction A takes the lower id and stays open; B takes a higher id and commits first.
    const txA = t.owner.db.transaction(async (tx) => {
      await tx.insert(schema.outboxEvents).values({
        workspaceId: lan.ownWorkspace,
        type: 'conversation.message.received.v1',
        aggregateType: 'conversation',
        aggregateId: a,
        payload: { messageId: 'gap-a', type: 'message', firstMessage: false },
      });
      inserted();
      await held;
    });
    await opened;
    await t.owner.db.insert(schema.outboxEvents).values({
      workspaceId: lan.ownWorkspace,
      type: 'conversation.message.received.v1',
      aggregateType: 'conversation',
      aggregateId: crypto.randomUUID(),
      payload: { messageId: 'gap-b', type: 'message', firstMessage: false },
    });

    expect(await projector.tick()).toBe(0);
    expect(await facts(lan.ownWorkspace)).toHaveLength(0);

    release();
    await txA;
    expect(await projector.tick()).toBe(2);
    expect(await facts(lan.ownWorkspace)).toHaveLength(2);
  });

  it('keeps each workspace to its own facts and does not let a workspace rewrite them', async () => {
    const lan = await t.user('lan8@an.vn', 'Chủ shop');
    const other = await t.user('other8@an.vn', 'Shop khác');
    await t.call(lan.h, 'POST', '/contacts', { name: 'Khách F' });
    await projector.tick();
    expect(await facts(other.ownWorkspace)).toEqual([]);
    const attempt = (stmt: ReturnType<typeof sql>) =>
      t.owner.db.transaction(async (tx) => {
        await tx.execute(sql`set local role app_tenant`);
        await tx.execute(sql`select set_config('app.workspace_id', ${lan.ownWorkspace}, true)`);
        await tx.execute(stmt);
      });
    await expect(attempt(sql`delete from analytics_facts`)).rejects.toThrow();
    await expect(attempt(sql`update analytics_facts set origin = 'channel'`)).rejects.toThrow();
    const crossTenant = await t.owner.db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_tenant`);
      await tx.execute(sql`select set_config('app.workspace_id', ${other.ownWorkspace}, true)`);
      return tx
        .select()
        .from(schema.analyticsFacts)
        .where(and(eq(schema.analyticsFacts.workspaceId, lan.ownWorkspace)));
    });
    expect(crossTenant).toEqual([]);
  });

  it('does not lose an event whose transaction commits after a higher id (xid and id orders differ)', async () => {
    const lan = await t.user('lan9@an.vn', 'Chủ shop');
    await projector.catchUp();
    const event = (n: string) => ({
      workspaceId: lan.ownWorkspace,
      type: 'conversation.message.received.v1',
      aggregateType: 'conversation',
      aggregateId: crypto.randomUUID(),
      payload: { messageId: n, type: 'message', firstMessage: false },
    });
    const gate = () => {
      let open!: () => void;
      const p = new Promise<void>((r) => (open = r));
      return { p, open };
    };
    const t1HasXid = gate();
    const t2Inserted = gate();
    const t2Finish = gate();

    // T1 gets the lower xid, T2 the higher; T2 inserts first (lower id) and stays open; T1 inserts
    // after (higher id) and commits first. A reader that trusted "the highest id seen" would move
    // past T2's row and never project it.
    const tx1 = t.owner.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_current_xact_id()`);
      t1HasXid.open();
      await t2Inserted.p;
      await tx.insert(schema.outboxEvents).values(event('late-low-xid'));
    });
    await t1HasXid.p;
    const tx2 = t.owner.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_current_xact_id()`);
      await tx.insert(schema.outboxEvents).values(event('early-high-xid'));
      t2Inserted.open();
      await t2Finish.p;
    });
    await t2Inserted.p;
    await tx1;

    // Only T1's row is settled; T2 is still running.
    expect(await projector.tick()).toBe(1);
    expect(await facts(lan.ownWorkspace)).toHaveLength(1);
    t2Finish.open();
    await tx2;
    // T2's row has the LOWER id, and is picked up now: nothing was skipped.
    expect(await projector.tick()).toBe(1);
    expect(await facts(lan.ownWorkspace)).toHaveLength(2);
    expect(await projector.tick()).toBe(0);
  });

  it('a rebuild dead-letters what it cannot read, like the live projection', async () => {
    const lan = await t.user('lan10@an.vn', 'Chủ shop');
    await t.call(lan.h, 'POST', '/contacts', { name: 'Khách R' });
    const [bad] = await t.owner.db
      .insert(schema.outboxEvents)
      .values({
        workspaceId: lan.ownWorkspace,
        type: 'crm.tag.removed.v1',
        aggregateType: 'contact',
        aggregateId: crypto.randomUUID(),
        payload: { assignmentId: 'nope' },
      })
      .returning({ id: schema.outboxEvents.id });
    const result = await projector.rebuild(lan.ownWorkspace as WorkspaceId);
    expect(result.facts).toBeGreaterThan(0);
    const dead = await t.owner.db
      .select()
      .from(schema.analyticsDeadLetters)
      .where(eq(schema.analyticsDeadLetters.outboxId, bad?.id ?? 0));
    expect(dead).toHaveLength(1);
  });
});
