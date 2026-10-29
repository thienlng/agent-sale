import { schema } from '@agent-sales/db';

import type { Harness, TestUser } from './harness.js';

export const D1 = '2026-10-20';
export const D2 = '2026-10-21';
export const AS_OF = '2026-10-21T16:59:59.999Z';
export const local = (day: string, time: string) => new Date(`${day}T${time}+07:00`).toISOString();

/** Independent source ledger from T-125. These fixtures write outbox events, never analytics facts. */
export async function seedGolden(t: Harness, user: TestUser, secondSales: string) {
  const ws = user.ownWorkspace;
  const ids = {
    c0: crypto.randomUUID(),
    c1: crypto.randomUUID(),
    c2: crypto.randomUUID(),
    c3: crypto.randomUUID(),
    tagA: crypto.randomUUID(),
    tagB: crypto.randomUUID(),
    statusNew: crypto.randomUUID(),
    statusQualified: crypto.randomUUID(),
    statusWon: crypto.randomUUID(),
    p1: crypto.randomUUID(),
    p2: crypto.randomUUID(),
    x: crypto.randomUUID(),
    y: crypto.randomUUID(),
    z: crypto.randomUUID(),
    a0: crypto.randomUUID(),
    a1: crypto.randomUUID(),
    a2: crypto.randomUUID(),
    b1: crypto.randomUUID(),
    a3: crypto.randomUUID(),
  };
  const source: Array<typeof schema.outboxEvents.$inferInsert> = [];
  const emit = (type: string, id: string, payload: object) => {
    source.push({
      workspaceId: ws,
      type,
      aggregateType: type.startsWith('crm.') ? 'contact' : 'conversation',
      aggregateId: id,
      payload,
    });
  };
  const crm = (type: string, id: string, at: string, extra: object = {}) =>
    emit(type, id, {
      workspaceId: ws,
      contactId: id,
      actorUserId: user.userId,
      occurredAt: at,
      ...extra,
    });
  for (const [id, name] of [
    [ids.statusNew, 'New'],
    [ids.statusQualified, 'Qualified'],
    [ids.statusWon, 'Won'],
  ] as const) {
    await t.owner.db
      .insert(schema.crmStatuses)
      .values({ id, workspaceId: ws, name, color: '#123456' });
  }
  const contacts = [
    {
      id: ids.c0,
      day: '2026-10-19',
      time: '09:00:00',
      origin: 'manual',
      phone: false,
      owner: user.userId,
      status: ids.statusNew,
    },
    {
      id: ids.c1,
      day: D1,
      time: '09:00:00',
      origin: 'manual',
      phone: false,
      owner: user.userId,
      status: ids.statusNew,
    },
    {
      id: ids.c2,
      day: D1,
      time: '09:30:00',
      origin: 'channel',
      phone: true,
      owner: user.userId,
      status: ids.statusNew,
    },
    {
      id: ids.c3,
      day: D2,
      time: '09:00:00',
      origin: 'import',
      phone: true,
      owner: secondSales,
      status: ids.statusWon,
    },
  ];
  for (const [index, c] of contacts.entries()) {
    const at = local(c.day, c.time);
    await t.owner.db.insert(schema.contacts).values({
      id: c.id,
      workspaceId: ws,
      name: `Golden C${index}`,
      createdAt: new Date(at),
      salesUserId: c.id === ids.c1 ? secondSales : c.owner,
      statusId: c.id === ids.c1 ? ids.statusWon : c.status,
    });
    crm('crm.contact.created.v1', c.id, at, {
      sourceId: null,
      origin: c.origin,
      phoneCaptured: c.phone,
      statusId: c.status,
    });
    crm('crm.contact.assigned.v1', c.id, at, {
      role: 'sales',
      fromUserId: null,
      toUserId: c.owner,
    });
  }
  crm('crm.contact.updated.v1', ids.c1, local(D1, '11:00:00'), {
    fields: ['phone'],
    phoneCaptured: true,
  });
  crm('crm.contact.updated.v1', ids.c1, local(D2, '11:30:00'), {
    fields: ['phone'],
    phoneCaptured: false,
  });
  const tag = (
    kind: 'assigned' | 'removed',
    c: string,
    day: string,
    time: string,
    tagId: string,
    assignmentId: string,
  ) => crm(`crm.tag.${kind}.v1`, c, local(day, time), { tagId, assignmentId, scope: 'contact' });
  tag('assigned', ids.c0, '2026-10-19', '10:00:00', ids.tagA, ids.a0);
  tag('assigned', ids.c1, D1, '12:00:00', ids.tagA, ids.a1);
  tag('assigned', ids.c1, D1, '12:01:00', ids.tagB, ids.b1);
  tag('assigned', ids.c2, D1, '12:02:00', ids.tagA, ids.a2);
  tag('removed', ids.c1, D1, '13:00:00', ids.tagA, ids.a1);
  tag('assigned', ids.c1, D2, '10:00:00', ids.tagA, ids.a3);
  tag('removed', ids.c2, D2, '11:00:00', ids.tagA, ids.a2);
  tag('removed', ids.c0, D2, '12:00:00', ids.tagA, ids.a0);
  for (const [id, day, time, from, to] of [
    [ids.c1, D1, '13:10:00', ids.statusNew, ids.statusQualified],
    [ids.c2, D1, '14:00:00', ids.statusNew, ids.statusQualified],
    [ids.c1, D2, '13:00:00', ids.statusQualified, ids.statusWon],
    [ids.c2, D2, '14:00:00', ids.statusQualified, ids.statusNew],
  ] as const)
    crm('crm.contact.status_changed.v1', id, local(day, time), {
      fromStatusId: from,
      toStatusId: to,
    });
  crm('crm.contact.assigned.v1', ids.c1, local(D2, '15:00:00'), {
    role: 'sales',
    fromUserId: user.userId,
    toUserId: secondSales,
  });
  const incoming = (
    convo: string,
    page: string,
    day: string,
    time: string,
    messageId: string,
    first: boolean,
  ) =>
    emit('conversation.message.received.v1', convo, {
      messageId,
      type: 'message',
      channelId: page,
      occurredAt: local(day, time),
      firstMessage: first,
    });
  incoming(ids.x, ids.p1, '2026-10-19', '10:00:00', 'x0', true);
  incoming(ids.x, ids.p1, D1, '10:00:00', 'x1', false);
  incoming(ids.y, ids.p1, D1, '10:01:00', 'y1', true);
  incoming(ids.y, ids.p1, D1, '10:02:00', 'y2', false);
  incoming(ids.y, ids.p1, D2, '10:01:00', 'y3', false);
  incoming(ids.z, ids.p2, D2, '10:02:00', 'z1', true);
  incoming(ids.z, ids.p2, D2, '10:03:00', 'z2', false);
  for (const [convo, page, day, id, sender, status] of [
    [ids.x, ids.p1, D1, 'sx1', 'human', 'sent'],
    [ids.y, ids.p1, D1, 'by1', 'bot', 'sent'],
    [ids.y, ids.p1, D2, 'sy1', 'human', 'sent'],
    [ids.z, ids.p2, D2, 'bz1', 'bot', 'sent'],
    [ids.z, ids.p2, D2, 'failed1', 'human', 'failed'],
    [ids.z, ids.p2, D2, 'pending1', 'bot', 'pending'],
  ] as const)
    emit('conversation.reply.completed.v1', convo, {
      messageId: id,
      channelId: page,
      occurredAt: local(day, '16:00:00'),
      sender,
      status,
    });
  await t.owner.db.insert(schema.outboxEvents).values(source);
  return { ...ids, source, ws, s1: user.userId, s2: secondSales };
}

/** G-B source values are independently specified, rather than copied from a returned card. */
export async function seedPortfolioBusiness(t: Harness, user: TestUser, workspaceId: string) {
  const source: Array<typeof schema.outboxEvents.$inferInsert> = [];
  for (let n = 1; n <= 5; n++) {
    const id = crypto.randomUUID();
    const at = local(n <= 2 ? D1 : D2, `09:0${n}:00`);
    await t.owner.db
      .insert(schema.contacts)
      .values({ id, workspaceId, name: `Portfolio B${n}`, createdAt: new Date(at) });
    source.push({
      workspaceId,
      aggregateType: 'contact',
      aggregateId: id,
      type: 'crm.contact.created.v1',
      payload: {
        workspaceId,
        contactId: id,
        actorUserId: user.userId,
        occurredAt: at,
        sourceId: null,
        origin: 'manual',
        phoneCaptured: n === 1 || n === 3,
        statusId: null,
      },
    });
  }
  const page = crypto.randomUUID();
  for (const [index, count, day] of [
    [0, 3, D1],
    [1, 2, D2],
    [2, 2, D2],
  ] as const) {
    const conversation = crypto.randomUUID();
    for (let n = 0; n < count; n++)
      source.push({
        workspaceId,
        aggregateType: 'conversation',
        aggregateId: conversation,
        type: 'conversation.message.received.v1',
        payload: {
          messageId: `portfolio-${index}-${n}`,
          type: 'message',
          channelId: page,
          occurredAt: local(day, `10:0${n}:00`),
          firstMessage: n === 0,
        },
      });
  }
  await t.owner.db.insert(schema.outboxEvents).values(source);
}
