import {
  AuthResponse,
  BootstrapResponse,
  ConversationDto,
  ConversationListResponse,
  ContactDto,
  ConversationTagAssignmentDto,
  CrmOptionDto,
  ContactListResponse,
  CrmOptionList,
  TagAssignmentDto,
  TagDto,
} from '@agent-sales/contracts';
import { createDb, ensureLoginRoles, eq, migrate, schema, withCredentials } from '@agent-sales/db';
import { newId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import {
  CONVERSATION_FACADE,
  type ConversationFacade,
} from '../src/modules/conversation/api/index.js';

/** Inbox v2 over HTTP on a real Postgres: read state, notes, assignee, tags and tag filters. */
let pg: TestPostgres;
let app: NestFastifyApplication;
let owner: ReturnType<typeof createDb>;
let inbox: ConversationFacade;

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  owner = createDb({ url: pg.ownerUrl, max: 2 });
  const booted = await createHttpApp(AppModule, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    DATABASE_SYSTEM_URL: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
  });
  app = booted.app;
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  inbox = app.get<ConversationFacade>(CONVERSATION_FACADE, { strict: false });
});

afterAll(async () => {
  await app?.close();
  await owner?.close();
  await pg?.stop();
});

type Headers = Record<string, string>;
const call = (
  h: Headers,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  url: string,
  payload?: object,
) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({ method, url: `/api/v1${url}`, headers: h, ...(payload ? { payload } : {}) });

let signups = 0;
async function shop(email: string, name: string) {
  const signup = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      remoteAddress: `10.2.0.${++signups}`,
      payload: {
        name,
        email,
        password: 'a long enough password',
        workspaceName: 'Shop',
        industry: 'fashion',
      },
    });
  const { accessToken } = AuthResponse.parse(signup.json());
  const authorization = `Bearer ${accessToken}`;
  const boot = BootstrapResponse.parse((await call({ authorization }, 'GET', '/bootstrap')).json());
  const ws = boot.memberships[0]?.workspaceId ?? '';
  const channelId = crypto.randomUUID();
  await owner.db.insert(schema.channelConnections).values({
    id: channelId,
    workspaceId: ws,
    provider: 'facebook',
    externalId: `page-${ws}`,
    name: 'Page',
    tokenSealed: 'sealed',
  });
  return {
    userId: boot.user.id,
    ws,
    channelId,
    h: { authorization, 'x-workspace-id': ws } as Headers,
    in: (id: string): Headers => ({ authorization, 'x-workspace-id': id }),
  };
}

async function member(ws: string, role: string) {
  const other = await shop(`${role}-${++signups}@shop.vn`, `Nhân viên ${role}`);
  await owner.db.insert(schema.members).values({
    id: crypto.randomUUID(),
    workspaceId: ws,
    userId: other.userId,
    role,
    status: 'active',
  });
  return other;
}

async function customer(s: { ws: string; channelId: string }, id: string, text: string) {
  return inbox.receive(workspaceId(s.ws), s.channelId, {
    kind: 'facebook',
    assetExternalId: `page-${s.ws}`,
    externalEventId: `${id}-1`,
    externalMessageId: `${id}-1`,
    senderExternalId: id,
    type: 'message',
    occurredAt: new Date(),
    text,
    raw: {},
  });
}

const list = async (h: Headers, query = '') => {
  const r = await call(h, 'GET', `/conversations${query}`);
  expect(r.statusCode, r.body).toBe(200);
  return ConversationListResponse.parse(r.json());
};
const ids = (r: { data: { id: string }[] }) => r.data.map((c) => c.id).sort();
const tag = async (h: Headers, name: string) => {
  const r = await call(h, 'POST', '/crm/tags', { name, type: 'classification' });
  expect(r.statusCode, r.body).toBe(201);
  return TagDto.parse(r.json());
};

describe('inbox v2 on Postgres', () => {
  it('tracks read state for the whole shop and keeps tab counts consistent', async () => {
    const a = await shop('inbox-read@shop.vn', 'Lan');
    const c1 = await customer(a, 'c1', 'Giá bao nhiêu? SDT 0912 345 678');
    const c2 = await customer(a, 'c2', 'Còn hàng không');
    expect((await list(a.h)).counts).toEqual({ all: 2, unread: 2, waiting: 2 });

    const read = await call(a.h, 'POST', `/conversations/${c1.id}/read`);
    expect(read.statusCode, read.body).toBe(200);
    expect(ConversationDto.parse(read.json())).toMatchObject({
      unreadCount: 0,
      lastReadBy: { userId: a.userId, name: 'Lan' },
      customerPhone: '0912345678',
    });
    const unread = await list(a.h, '?tab=unread');
    expect(ids(unread)).toEqual([c2.id]);
    // Counts ignore the tab: both tabs still report the same numbers.
    expect(unread.counts).toEqual({ all: 2, unread: 1, waiting: 2 });
    expect(ids(await list(a.h, '?waiting=readNotReplied'))).toEqual([c1.id]);
    expect(ids(await list(a.h, '?hasPhone=true'))).toEqual([c1.id]);
    expect(ids(await list(a.h, '?q=0912'))).toEqual([c1.id]);

    const back = ConversationDto.parse(
      (await call(a.h, 'POST', `/conversations/${c1.id}/unread`)).json(),
    );
    expect(back).toMatchObject({ unreadCount: 1, lastReadAt: null, lastReadBy: null });
  });

  it('adds notes, assigns active members only and enforces permissions and tenancy', async () => {
    const a = await shop('inbox-notes@shop.vn', 'Chủ shop');
    const b = await shop('inbox-notes-b@shop.vn', 'Shop khác');
    const sales = await member(a.ws, 'sales');
    const analyst = await member(a.ws, 'analyst');
    const c = await customer(a, 'c1', 'Xin chào');

    const note = await call(a.h, 'POST', `/conversations/${c.id}/notes`, { text: 'Cần gọi lại' });
    expect(note.statusCode, note.body).toBe(201);
    expect(ConversationDto.parse(note.json()).notes).toEqual([
      expect.objectContaining({ authorId: a.userId, authorName: 'Chủ shop', text: 'Cần gọi lại' }),
    ]);
    expect(
      (await call(a.h, 'POST', `/conversations/${c.id}/notes`, { text: '  ' })).statusCode,
    ).toBe(400);

    const assigned = await call(a.h, 'PATCH', `/conversations/${c.id}`, {
      assigneeId: sales.userId,
    });
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(ConversationDto.parse(assigned.json()).assigneeId).toBe(sales.userId);
    expect(ids(await list(a.h, `?assignee=${sales.userId}`))).toEqual([c.id]);
    expect(ids(await list(sales.in(a.ws), '?assignee=me'))).toEqual([c.id]);
    expect(ids(await list(a.h, '?assignee=none'))).toEqual([]);
    // Someone of another shop is not assignable.
    const stranger = await call(a.h, 'PATCH', `/conversations/${c.id}`, { assigneeId: b.userId });
    expect(stranger.statusCode).toBe(400);
    const cleared = await call(a.h, 'PATCH', `/conversations/${c.id}`, { assigneeId: null });
    expect(ConversationDto.parse(cleared.json()).assigneeId).toBeNull();

    // A reader cannot change shared state; another shop cannot even see it.
    for (const path of ['read', 'unread'])
      expect(
        (await call(analyst.in(a.ws), 'POST', `/conversations/${c.id}/${path}`)).statusCode,
      ).toBe(403);
    expect(
      (await call(analyst.in(a.ws), 'POST', `/conversations/${c.id}/notes`, { text: 'x' }))
        .statusCode,
    ).toBe(403);
    const bodies = { read: {}, unread: {}, notes: { text: 'x' }, tags: { tagId: newId() } };
    for (const [path, body] of Object.entries(bodies))
      expect((await call(b.h, 'POST', `/conversations/${c.id}/${path}`, body)).statusCode).toBe(
        404,
      );
    expect((await call(b.h, 'GET', `/conversations/${c.id}/tags`)).statusCode).toBe(404);
  });

  it('tags conversations from the shared library and filters by any, all, exclude and untagged', async () => {
    const a = await shop('inbox-tags@shop.vn', 'Chủ shop');
    const b = await shop('inbox-tags-b@shop.vn', 'Shop khác');
    const analyst = await member(a.ws, 'analyst');
    const [c1, c2, c3] = [
      await customer(a, 'c1', 'một'),
      await customer(a, 'c2', 'hai'),
      await customer(a, 'c3', 'ba'),
    ];
    const [hot, vip] = [await tag(a.h, 'Chốt đơn'), await tag(a.h, 'Khách VIP')];
    const add = (conv: string, t: TagDto, h = a.h) =>
      call(h, 'POST', `/conversations/${conv}/tags`, { tagId: t.id });

    const first = await add(c1!.id, hot);
    expect(first.statusCode, first.body).toBe(201);
    const assignment = ConversationTagAssignmentDto.parse(first.json());
    expect(assignment).toMatchObject({
      scope: 'conversation',
      tag: { id: hot.id, name: 'Chốt đơn' },
    });
    const again = await add(c1!.id, hot);
    expect(again.statusCode).toBe(200);
    expect(ConversationTagAssignmentDto.parse(again.json()).id).toBe(assignment.id);
    await add(c1!.id, vip);
    await add(c2!.id, hot);

    const rows = await list(a.h);
    expect(rows.data.find((c) => c.id === c1!.id)?.tags.map((t) => t.name)).toEqual([
      'Chốt đơn',
      'Khách VIP',
    ]);
    expect(rows.data.find((c) => c.id === c3!.id)?.tags).toEqual([]);

    const q = (s: string) => list(a.h, `?${s}`).then(ids);
    expect(await q(`tagsAny=${hot.id},${vip.id}`)).toEqual([c1!.id, c2!.id].sort());
    expect(await q(`tagsAny=${vip.id}`)).toEqual([c1!.id]);
    expect(await q(`tagsAll=${hot.id},${vip.id}`)).toEqual([c1!.id]);
    expect(await q(`tagsExclude=${vip.id}`)).toEqual([c2!.id, c3!.id].sort());
    expect(await q('untagged=true')).toEqual([c3!.id]);
    expect(await q(`tagsAny=${hot.id}&tagsExclude=${vip.id}`)).toEqual([c2!.id]);
    expect(await q(`tagsAny=${hot.id}&tagsAny=${vip.id}`)).toEqual([c1!.id, c2!.id].sort());
    // Tag filters narrow the counts too.
    expect((await list(a.h, `?tagsAll=${hot.id},${vip.id}`)).counts.all).toBe(1);
    expect((await call(a.h, 'GET', `/conversations?tagsAny=not-a-uuid`)).statusCode).toBe(400);

    const detail = (await call(a.h, 'GET', `/conversations/${c1!.id}`)).json() as {
      conversation: { tags: unknown[] };
    };
    expect(detail.conversation.tags).toHaveLength(2);
    const listed = (await call(a.h, 'GET', `/conversations/${c1!.id}/tags`)).json() as {
      data: unknown[];
    };
    expect(listed.data).toHaveLength(2);

    // Removal goes through the shared assignment route and is idempotent.
    const removed = await call(a.h, 'POST', `/tag-assignments/${assignment.id}/remove`, {});
    expect(removed.statusCode, removed.body).toBe(200);
    expect(TagAssignmentDto.parse(removed.json()).removedAt).not.toBeNull();
    expect(
      (await call(a.h, 'POST', `/tag-assignments/${assignment.id}/remove`, {})).statusCode,
    ).toBe(200);
    expect(await q(`tagsAny=${hot.id}`)).toEqual([c2!.id]);
    // Values of a conversation tag cannot be edited through the customer route.
    expect(
      (
        await call(a.h, 'PATCH', `/tag-assignments/${assignment.id}`, {
          values: {},
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(404);

    // Conversation tags do not count as customer tags, and tenants and roles stay apart.
    const library = (await call(a.h, 'GET', '/crm/tags')).json() as { data: TagDto[] };
    expect(library.data.find((t) => t.id === hot.id)?.activeCount).toBe(0);
    expect((await add(c1!.id, hot, b.h)).statusCode).toBe(404);
    expect((await add(c3!.id, { ...hot, id: newId() })).statusCode).toBe(404);
    expect((await add(c3!.id, hot, analyst.in(a.ws))).statusCode).toBe(403);
    expect((await list(b.h)).data).toEqual([]);
    expect(
      (await call(b.h, 'POST', `/tag-assignments/${assignment.id}/remove`, {})).statusCode,
    ).toBe(404);
  });

  it('hides archived tags from chips and from the untagged filter', async () => {
    const a = await shop('inbox-archived@shop.vn', 'Chủ shop');
    const c = await customer(a, 'c1', 'một');
    const t = await tag(a.h, 'Tạm thời');
    await call(a.h, 'POST', `/conversations/${c.id}/tags`, { tagId: t.id });
    expect(ids(await list(a.h, '?untagged=true'))).toEqual([]);
    const archived = await call(a.h, 'PATCH', `/crm/tags/${t.id}`, {
      archived: true,
      expectedVersion: t.version,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    expect((await list(a.h)).data[0]?.tags).toEqual([]);
    expect(ids(await list(a.h, '?untagged=true'))).toEqual([c.id]);
    expect(
      (await call(a.h, 'POST', `/conversations/${c.id}/tags`, { tagId: t.id })).statusCode,
    ).toBeGreaterThanOrEqual(400);
  });
  it('keeps one set of tags and customer statuses, managed in Customer settings (T-089)', async () => {
    const a = await shop('inbox-settings@shop.vn', 'Chủ shop');
    const other = await shop('inbox-settings-other@shop.vn', 'Shop khác');
    const seller = await member(a.ws, 'sales');
    const c = await customer(a, 'c1', 'xin chào');

    // A tag created in Customer settings is the one the inbox assigns; a rename shows everywhere.
    const vip = await tag(a.h, 'Khách VIP');
    expect(
      (await call(a.h, 'POST', `/conversations/${c.id}/tags`, { tagId: vip.id })).statusCode,
    ).toBe(201);
    const renamed = await call(a.h, 'PATCH', `/crm/tags/${vip.id}`, {
      name: 'Khách thân thiết',
      expectedVersion: vip.version,
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    const onConversation = (await call(a.h, 'GET', `/conversations/${c.id}/tags`)).json() as {
      data: ConversationTagAssignmentDto[];
    };
    expect(onConversation.data.map((x) => [x.tag.id, x.tag.name])).toEqual([
      [vip.id, 'Khách thân thiết'],
    ]);
    expect((await list(a.h)).data[0]?.tags.map((x) => x.name)).toEqual(['Khách thân thiết']);
    expect(
      (await call(a.h, 'POST', '/crm/tags', { name: 'KHÁCH THÂN THIẾT', type: 'classification' }))
        .statusCode,
    ).toBe(409);

    // A status renamed in Customer settings keeps its id on the customer.
    const created = await call(a.h, 'POST', '/crm/statuses', {
      name: 'Đang tư vấn',
      color: '#2255aa',
    });
    expect(created.statusCode, created.body).toBe(201);
    const consulting = CrmOptionDto.parse(created.json());
    const person = await call(a.h, 'POST', '/contacts', {
      name: 'Chị Hoa',
      statusId: consulting.id,
    });
    expect(person.statusCode, person.body).toBe(201);
    const hoa = ContactDto.parse(person.json());
    await call(a.h, 'PATCH', `/crm/statuses/${consulting.id}`, { name: 'Đang chăm sóc' });
    const statuses = CrmOptionList.parse((await call(a.h, 'GET', '/crm/statuses')).json()).data;
    expect(statuses.find((x) => x.id === consulting.id)?.name).toBe('Đang chăm sóc');

    // Active statuses keep distinct names; an archived one frees its name but cannot come back
    // while another active status uses it.
    const dup = await call(a.h, 'POST', '/crm/statuses', {
      name: ' đang CHĂM sóc ',
      color: '#000000',
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({
      error: { code: 'CONFLICT', details: { kind: 'status', name: 'đang CHĂM sóc' } },
    });
    await call(a.h, 'PATCH', `/crm/statuses/${consulting.id}`, { archived: true });
    const twin = await call(a.h, 'POST', '/crm/statuses', {
      name: 'Đang chăm sóc',
      color: '#000000',
    });
    expect(twin.statusCode, twin.body).toBe(201);
    expect(
      (await call(a.h, 'PATCH', `/crm/statuses/${consulting.id}`, { archived: false })).statusCode,
    ).toBe(409);
    // Archiving keeps the customer's status (history is preserved).
    const kept = ContactDto.parse((await call(a.h, 'GET', `/contacts/${hoa.id}`)).json());
    expect(kept.statusId).toBe(consulting.id);

    // The customer status is not the conversation's open/resolved state, nor the bot switch.
    const resolved = await call(a.h, 'PATCH', `/conversations/${c.id}`, {
      status: 'resolved',
      mode: 'human',
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    expect(ContactDto.parse((await call(a.h, 'GET', `/contacts/${hoa.id}`)).json())).toMatchObject({
      statusId: consulting.id,
      version: kept.version,
    });

    // Only settings managers change definitions, and only in their own business.
    const sh = seller.in(a.ws);
    expect(
      (await call(sh, 'POST', '/crm/statuses', { name: 'Mới', color: '#000000' })).statusCode,
    ).toBe(403);
    expect(
      (await call(sh, 'PATCH', `/crm/tags/${vip.id}`, { name: 'X', expectedVersion: 2 }))
        .statusCode,
    ).toBe(403);
    expect((await call(sh, 'GET', '/crm/tags')).statusCode).toBe(200);
    expect(
      (await call(other.h, 'PATCH', `/crm/statuses/${twin.json().id}`, { name: 'Y' })).statusCode,
    ).toBe(404);
    expect(
      (await call(other.h, 'PATCH', `/crm/tags/${vip.id}`, { name: 'Y', expectedVersion: 2 }))
        .statusCode,
    ).toBe(404);
  });

  it('links conversations to one customer per phone and filters customers by bot (T-088)', async () => {
    const a = await shop('inbox-contacts@shop.vn', 'Chủ shop');
    const b = await shop('inbox-contacts-b@shop.vn', 'Shop khác');
    const analyst = await member(a.ws, 'analyst');
    const newBot = async (name: string) => {
      const r = await call(a.h, 'POST', '/bots', { name, industry: 'fashion' });
      expect(r.statusCode, r.body).toBe(201);
      return (r.json() as { id: string }).id;
    };
    const [bot1, bot2, bot3] = [
      await newBot('Bot 1'),
      await newBot('Bot 2'),
      await newBot('Bot 3'),
    ];
    const page2 = crypto.randomUUID();
    await owner.db.insert(schema.channelConnections).values({
      id: page2,
      workspaceId: a.ws,
      provider: 'instagram',
      externalId: `ig-${a.ws}`,
      name: 'Instagram',
      tokenSealed: 'sealed',
      botId: bot2,
    });
    const bind = (id: string, botId: string) =>
      owner.db
        .update(schema.channelConnections)
        .set({ botId })
        .where(eq(schema.channelConnections.id, id));
    await bind(a.channelId, bot1);
    const onPage2 = (sender: string, text: string, n = 1) =>
      inbox.receive(workspaceId(a.ws), page2, {
        kind: 'instagram',
        assetExternalId: `ig-${a.ws}`,
        externalEventId: `${sender}-${n}`,
        externalMessageId: `${sender}-${n}`,
        senderExternalId: sender,
        type: 'message',
        occurredAt: new Date(),
        text,
        raw: {},
      });
    const detail = async (id: string) =>
      ConversationDto.parse(
        (
          (await call(a.h, 'GET', `/conversations/${id}`)).json() as {
            conversation: unknown;
          }
        ).conversation,
      );
    const byBot = async (op: 'has_any' | 'has_none', bots: string[]) => {
      const r = await call(a.h, 'POST', '/contacts/query', {
        filter: { rules: [{ field: 'botId', op, value: bots }] },
      });
      expect(r.statusCode, r.body).toBe(200);
      return ContactListResponse.parse(r.json()).data.map((c) => c.id);
    };

    // No phone yet: no customer.
    const fb = await customer(a, 'lan-fb', 'Chào shop');
    expect((await detail(fb.id)).contactId).toBeNull();
    // A phone on Facebook creates the customer and links it; the same phone on Instagram finds it.
    await inbox.receive(workspaceId(a.ws), a.channelId, {
      kind: 'facebook',
      assetExternalId: `page-${a.ws}`,
      externalEventId: 'lan-fb-2',
      externalMessageId: 'lan-fb-2',
      senderExternalId: 'lan-fb',
      type: 'message',
      occurredAt: new Date(),
      text: 'Số mình 0903 456 781 nhé',
      raw: {},
    });
    const contactId = (await detail(fb.id)).contactId;
    expect(contactId).not.toBeNull();
    const ig = await onPage2('lan-ig', 'Gọi 0903.456.781 giúp mình');
    expect((await detail(ig.id)).contactId).toBe(contactId);
    const lan = ContactDto.parse((await call(a.h, 'GET', `/contacts/${contactId}`)).json());
    expect(lan.phone).toBe('+84903456781');
    expect(ids(await list(a.h, `?contactId=${contactId}`))).toEqual([fb.id, ig.id].sort());

    // Both bots talked with her; moving page 1 to bot 3 keeps bot 1 in her history.
    expect(await byBot('has_any', [bot1])).toEqual([contactId]);
    expect(await byBot('has_any', [bot2])).toEqual([contactId]);
    expect(await byBot('has_any', [bot3])).toEqual([]);
    await bind(a.channelId, bot3);
    await inbox.receive(workspaceId(a.ws), a.channelId, {
      kind: 'facebook',
      assetExternalId: `page-${a.ws}`,
      externalEventId: 'lan-fb-3',
      externalMessageId: 'lan-fb-3',
      senderExternalId: 'lan-fb',
      type: 'message',
      occurredAt: new Date(),
      text: 'Còn hàng không?',
      raw: {},
    });
    expect(await byBot('has_any', [bot1])).toEqual([contactId]);
    expect(await byBot('has_any', [bot3])).toEqual([contactId]);
    expect(await byBot('has_none', [bot1])).toEqual([]);

    // Staff unlink and link again; a reader cannot, another business's customer is not found.
    const set = (h: Headers, id: string, value: string | null) =>
      call(h, 'PUT', `/conversations/${id}/contact`, { contactId: value });
    const unlinked = await set(a.h, ig.id, null);
    expect(unlinked.statusCode, unlinked.body).toBe(200);
    expect(ConversationDto.parse(unlinked.json()).contactId).toBeNull();
    // Staff's "no customer" sticks: her phone in the next message does not link her again.
    await onPage2('lan-ig', 'Vẫn số 0903 456 781 nhé', 2);
    expect(await detail(ig.id)).toMatchObject({ contactId: null, contactLinkedBy: 'staff' });
    const relinked = await set(a.h, ig.id, contactId);
    expect(ConversationDto.parse(relinked.json()).contactId).toBe(contactId);
    expect((await set(analyst.in(a.ws), ig.id, null)).statusCode).toBe(403);
    const foreign = await call(b.h, 'POST', '/contacts', { name: 'Khách B', phone: '0987111222' });
    expect(foreign.statusCode, foreign.body).toBe(201);
    expect((await set(a.h, ig.id, ContactDto.parse(foreign.json()).id)).statusCode).toBe(404);
    expect((await set(b.h, ig.id, null)).statusCode).toBe(404);
    expect((await detail(ig.id)).contactId).toBe(contactId);
  });
});
