import type { NormalizedEvent } from '@agent-sales/channels';
import {
  createDb,
  ensureLoginRoles,
  migrate,
  eq,
  schema,
  sql,
  withCredentials,
  withSystem,
  withTenant,
  type Database,
} from '@agent-sales/db';
import { newId, userId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type BotFacade, BotLifecycle, type BotView } from '../../bot/api/index.js';
import type { ChannelFacade } from '../../channel/api/index.js';
import { ConversationFacadeImpl } from '../application/conversation.facade.impl.js';
import { filterConversations, type ConversationFilter } from '../domain/conversation-filter.js';
import { DrizzleConversationStore } from '../infrastructure/persistence/conversation.store.js';
import { fakeCrm, fakeIdentity, fakeTeam } from './fakes.js';

/** The conversation store's SQL on a real Postgres, driven through the facade. */
let pg: TestPostgres;
const handles: { close: () => Promise<void> }[] = [];
let a: WorkspaceId;
let b: WorkspaceId;
const channelId = newId();
let service: ConversationFacadeImpl;
let store: DrizzleConversationStore;
let tenantDb: Database;
let channels: ChannelFacade;

function open(url: string, max: number): Database {
  const h = createDb({ url, max });
  handles.push(h);
  return h.db;
}

function event(id: string, sender = 'customer-1', text = `hello ${id}`): NormalizedEvent {
  return {
    kind: 'facebook',
    assetExternalId: 'page',
    externalEventId: id,
    externalMessageId: id,
    senderExternalId: sender,
    type: 'message',
    occurredAt: new Date(),
    text,
    raw: {},
  };
}

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  const tenantUrl = withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password);
  const tenant = open(tenantUrl, 4);
  const system = open(
    withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
    1,
  );
  a = workspaceId(newId());
  b = workspaceId(newId());
  for (const ws of [a, b]) {
    const id = userId(newId());
    await withSystem(system, (tx) =>
      tx.insert(schema.users).values({ id, email: `${id}@example.test`, name: 'Owner' }),
    );
    await withTenant(tenant, ws, (tx) =>
      tx.insert(schema.workspaces).values({
        id: ws,
        workspaceId: ws,
        name: 'Shop',
        industry: 'retail',
        ownerUserId: id,
      }),
    );
  }
  await withTenant(tenant, a, (tx) =>
    tx.insert(schema.channelConnections).values({
      id: channelId,
      workspaceId: a,
      provider: 'facebook',
      externalId: 'page',
      name: 'Page',
      tokenSealed: 'sealed',
    }),
  );
  channels = {
    getConnection: vi.fn(async () => ({
      id: channelId,
      provider: 'facebook' as const,
      externalId: 'page',
      name: 'Page',
      status: 'connected' as const,
      botId: null,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    })),
    deliver: vi.fn(async () => ({
      externalId: `out-${newId()}`,
      status: 'sent' as const,
      failureCode: null,
    })),
  } as unknown as ChannelFacade;
  const bots: BotFacade = { getBot: async () => ({}) as BotView };
  store = new DrizzleConversationStore(tenant);
  tenantDb = tenant;
  service = new ConversationFacadeImpl(
    store,
    channels,
    bots,
    fakeTeam(),
    fakeIdentity(),
    fakeCrm() as never,
  );
});

afterAll(async () => {
  for (const h of handles) await h.close();
  await pg?.stop();
});

describe('DrizzleConversationStore', () => {
  it('deduplicates a redelivered inbound event and hides it from another tenant', async () => {
    const c = await service.receive(a, channelId, event('dup'));
    await service.receive(a, channelId, event('dup'));
    expect((await service.get(a, c.id)).messages).toHaveLength(1);
    await expect(service.get(b, c.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await service.list(b, { limit: 50 } as never)).data).toEqual([]);
    await expect(service.update(b, c.id, { note: 'steal' }, newId())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('keeps one conversation per customer when a burst arrives concurrently', async () => {
    const burst = ['b1', 'b2', 'b3', 'b4'].map((id) => event(id, 'customer-burst'));
    const results = await Promise.all(burst.map((e) => service.receive(a, channelId, e)));
    expect(new Set(results.map((c) => c.id)).size).toBe(1);
    expect((await service.get(a, results[0]!.id)).messages).toHaveLength(4);
  });

  it('delivers a staff reply once for a repeated idempotency key', async () => {
    const c = await service.receive(a, channelId, event('to-answer', 'customer-reply'));
    const body = { text: 'We have it in stock', idempotencyKey: newId() };
    const staff = newId();
    const first = await service.send(a, c.id, body, staff);
    expect(await service.send(a, c.id, body, staff)).toEqual(first);
    expect(channels.deliver).toHaveBeenCalledTimes(1);
    const outbound = (await service.get(a, c.id)).messages.filter((m) => m.direction !== 'inbound');
    expect(outbound).toHaveLength(1);
  });

  it('reads Today candidates for one member and the last staff reply only where asked', async () => {
    const staff = newId();
    const replied = await service.receive(a, channelId, event('today-1', 'customer-today-1'));
    const other = await service.receive(a, channelId, event('today-2', 'customer-today-2'));
    await service.send(a, replied.id, { text: 'Dạ', idempotencyKey: newId() }, staff);
    await service.send(a, other.id, { text: 'Dạ', idempotencyKey: newId() }, staff);
    // A reply assigns the conversation to its sender; the first goes back to nobody (the
    // assignee column, what the filter reads).
    await withTenant(tenantDb, a, (tx) =>
      tx
        .update(schema.conversations)
        .set({
          assigneeId: null,
          data: sql`jsonb_set(${schema.conversations.data}, '{assigneeId}', 'null'::jsonb)`,
        })
        .where(eq(schema.conversations.id, replied.id)),
    );
    const q = {
      ids: [replied.id, other.id],
      awaitingBefore: new Date(0),
      followUpBefore: new Date(0),
      limit: 10,
    };
    const all = await service.todayCandidates(a, { ...q, lastHumanFor: [replied.id] });
    const byId = new Map(all.map((f) => [f.id, f]));
    expect(byId.get(replied.id)?.lastHumanReplyAt).not.toBeNull();
    expect(byId.get(other.id)?.lastHumanReplyAt).toBeNull();
    expect((await service.todayCandidates(a, q)).every((f) => f.lastHumanReplyAt)).toBe(true);
    const someoneElse = await service.todayCandidates(a, { ...q, visibleTo: newId() });
    expect(someoneElse.map((f) => f.id)).toEqual([replied.id]);
    const mine = await service.todayCandidates(a, { ...q, visibleTo: staff });
    expect(mine.map((f) => f.id).sort()).toEqual([replied.id, other.id].sort());
  });

  it('refuses a care message once the customer wrote, sends it after the bot answered, and attributes per point', async () => {
    const c = await service.receive(a, channelId, event('timeline-1', 'customer-timeline'));
    const anchor = new Date(c.lastInboundAt);
    const patch = (json: string) =>
      withTenant(tenantDb, a, (tx) =>
        tx
          .update(schema.conversations)
          .set({ mode: 'bot', data: sql`${schema.conversations.data} || ${json}::jsonb` })
          .where(eq(schema.conversations.id, c.id)),
      );
    // The bot holds it (as the bot module would), but nobody answered the customer yet: a
    // follow-up is refused in the reserving transaction.
    await patch('{"mode":"bot"}');
    await expect(
      service.commitCareMessage(a, c.id, {
        text: 'Dạ còn ạ',
        idempotencyKey: 'care:t0',
        anchorAt: anchor,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'customer_replied' } });
    // The bot answered.
    await patch('{"lastMessageSender":"bot"}');
    // A follow-up written for an older customer message is refused too.
    await expect(
      service.commitCareMessage(a, c.id, {
        text: 'Dạ còn ạ',
        idempotencyKey: 'care:t0',
        anchorAt: new Date(anchor.getTime() - 1000),
      }),
    ).rejects.toMatchObject({ details: { reason: 'customer_replied' } });
    const care = await service.commitCareMessage(a, c.id, {
      text: 'Dạ còn ạ',
      idempotencyKey: 'care:t1',
      anchorAt: anchor,
    });
    expect(care).toMatchObject({ sender: 'bot', source: 'care' });
    // The same key again returns the first message (no second send).
    expect(
      (
        await service.commitCareMessage(a, c.id, {
          text: 'Dạ còn ạ',
          idempotencyKey: 'care:t1',
          anchorAt: anchor,
        })
      ).id,
    ).toBe(care.id);
    const staff = newId();
    await service.send(a, c.id, { text: 'Em Lan đây', idempotencyKey: newId() }, staff);
    // A person holds it now: no follow-up.
    await expect(
      service.commitCareMessage(a, c.id, {
        text: 'Dạ',
        idempotencyKey: 'care:t2',
        anchorAt: anchor,
      }),
    ).rejects.toMatchObject({ details: { reason: 'taken_over' } });
    const later = new Date(Date.now() + 60_000);
    const [touch, none] = await service.aiTouches(
      a,
      [
        { conversationId: c.id, at: later },
        { conversationId: c.id, at: new Date(anchor.getTime() - 1000) },
      ],
      7 * 86_400_000,
    );
    expect(touch?.firstBotAt).not.toBeNull();
    expect(touch?.staffAfter).toBe(true);
    expect(none).toEqual({ firstBotAt: null, staffAfter: false });
    expect(
      await service.aiTouches(b, [{ conversationId: c.id, at: later }], 7 * 86_400_000),
    ).toEqual([{ firstBotAt: null, staffAfter: false }]);
    const facts = await service.followUpFacts(a, c.id);
    expect(facts).toMatchObject({ mode: 'human', status: 'open' });
    expect(facts?.lastHumanAt).not.toBeNull();
  });

  it('serves stored Rapiz attachments on the current public host, other links unchanged', async () => {
    const c = await service.receive(a, channelId, event('old-host', 'customer-media'));
    const key =
      'products/01a1a2cd-8961-74a4-a65d-3b4c9bfb5d7b/01a1a2cd-9029-775e-897b-7cecc54682ac.jpg';
    const fb = 'https://scontent.xx.fbcdn.net/v/t1/x.jpg?_nc_cat=1';
    const msg = {
      id: newId(),
      conversationId: c.id,
      direction: 'outbound' as const,
      sender: 'bot' as const,
      text: '',
      attachments: [
        { type: 'image' as const, url: `https://dead-tunnel.trycloudflare.com/media/${key}` },
        { type: 'image' as const, url: fb },
      ],
      status: 'sent' as const,
      failureCode: null,
      externalId: null,
      createdAt: new Date().toISOString(),
    };
    await store.run(a, (tx) => tx.saveMessage(msg, newId()));
    const current = new DrizzleConversationStore(tenantDb, 'https://penguin.example.com/media');
    const read = await current.run(a, (tx) => tx.messages(c.id));
    expect(read.find((m) => m.id === msg.id)?.attachments.map((x) => x.url)).toEqual([
      `https://penguin.example.com/media/${key}`,
      fb,
    ]);
    // Without a configured base the stored URL is returned as it is.
    const plain = await store.run(a, (tx) => tx.messages(c.id));
    expect(plain.find((m) => m.id === msg.id)?.attachments[0]?.url).toContain('dead-tunnel');
  });
});

/** SQL filtering, counting and sorting must agree with the reference the unit tests exercise. */
describe('DrizzleConversationStore inbox v2 query', () => {
  const staff = newId();
  const base: ConversationFilter = { tab: 'all', sort: 'recent', limit: 100 };

  async function seed() {
    const customers = ['q-1', 'q-2', 'q-3', 'q-4', 'q-5'];
    const made = [];
    for (const [i, id] of customers.entries()) {
      made.push(
        await service.receive(
          a,
          channelId,
          event(`qe-${id}`, id, i === 0 ? 'call 0912 345 678, 100% sure_' : `hi ${id}`),
        ),
      );
    }
    const [c0, c1, c2, c3, c4] = made;
    await service.markRead(a, c0!.id, staff);
    await service.send(a, c1!.id, { text: 'ok', idempotencyKey: newId() }, staff);
    await service.update(a, c2!.id, { status: 'resolved' }, staff);
    await service.update(a, c3!.id, { assigneeId: null, mode: 'human' }, staff);
    await service.update(a, c3!.id, { status: 'spam' }, staff);
    await service.update(
      a,
      c4!.id,
      { starred: true, followUpAt: '2030-01-01T02:00:00.000Z' },
      staff,
    );
    return made.map((c) => c.id);
  }

  it('matches the reference for every filter combination and keeps counts tab-independent', async () => {
    await seed();
    const everything = (await store.run(a, (tx) => tx.query(base))).data;
    const filters: Partial<ConversationFilter>[] = [
      {},
      { tab: 'unread' },
      { tab: 'waiting' },
      { status: 'open' },
      { status: 'resolved', tab: 'unread' },
      { status: 'spam' },
      { status: 'spam', tab: 'waiting' },
      { starred: true },
      { starred: false, tab: 'unread' },
      { followUp: true },
      { followUp: false, status: 'open' },
      { mode: 'human' },
      { provider: 'facebook' },
      { assignee: 'none' },
      { assignee: staff },
      { channelId },
      { channelId: newId() },
      { hasPhone: true },
      { hasPhone: false, tab: 'waiting' },
      { waiting: 'any' },
      { waiting: 'readNotReplied' },
      { waiting: 'longest' },
      { sort: 'waitingLongest' },
      { q: '0912' },
      { q: '100%' },
      { q: 'sure_' },
      { q: 'HI Q-3' },
      { limit: 2 },
      { idsIn: [everything[0]!.id, everything[1]!.id] },
      { idsIn: [] },
      { idsNotIn: [everything[0]!.id] },
      { idsIn: everything.map((c) => c.id), idsNotIn: [everything[1]!.id], tab: 'unread' },
      { botId: 'none' },
      { botId: newId() },
      { botId: 'none', tab: 'waiting' },
      { updatedFrom: everything[2]!.updatedAt },
      { updatedTo: everything[2]!.updatedAt },
      { updatedFrom: everything[3]!.updatedAt, updatedTo: everything[1]!.updatedAt, tab: 'unread' },
      { updatedFrom: '2099-01-01T00:00:00.000Z' },
    ];
    for (const f of filters) {
      const filter = { ...base, ...f };
      const sql = await store.run(a, (tx) => tx.query(filter));
      const ref = filterConversations(everything, filter);
      expect(
        sql.data.map((c) => c.id),
        JSON.stringify(f),
      ).toEqual(ref.data.map((c) => c.id));
      expect(sql.counts, JSON.stringify(f)).toEqual(ref.counts);
    }
  });

  it('filters by the answering bot column, matching the reference', async () => {
    await seed();
    const bot = newId();
    await withTenant(tenantDb, a, (tx) =>
      tx
        .insert(schema.bots)
        .values({ id: bot, workspaceId: a, name: 'Bot', industry: 'retail', settings: {} }),
    );
    const connection = await channels.getConnection(a, channelId);
    vi.mocked(channels.getConnection).mockResolvedValueOnce({ ...connection, botId: bot });
    const answered = await service.receive(a, channelId, event('qe-bot', 'q-bot', 'hi bot'));
    const everything = (await store.run(a, (tx) => tx.query(base))).data;
    for (const f of [{ botId: bot }, { botId: 'none' }, { botId: bot, tab: 'unread' as const }]) {
      const filter = { ...base, ...f };
      const sql = await store.run(a, (tx) => tx.query(filter));
      expect(sql.data.map((c) => c.id)).toEqual(
        filterConversations(everything, filter).data.map((c) => c.id),
      );
    }
    expect((await store.run(a, (tx) => tx.query({ ...base, botId: bot }))).data).toEqual([
      expect.objectContaining({ id: answered.id }),
    ]);
  });

  it('keeps the index columns in step with the document on every save', async () => {
    const [id] = await seed();
    await service.addNote(a, id!, 'note', staff);
    await service.update(a, id!, { assigneeId: null }, staff);
    const view = (await service.get(a, id!)).conversation;
    const [row] = await withTenant(tenantDb, a, (tx) =>
      tx.select().from(schema.conversations).where(eq(schema.conversations.id, id!)),
    );
    expect(row).toMatchObject({
      unreadCount: view.unreadCount,
      assigneeId: view.assigneeId,
      mode: view.mode,
      status: view.status,
      customerPhone: view.customerPhone,
    });
    expect(row?.awaitingSince?.toISOString() ?? null).toBe(view.awaitingSince);
    expect(row?.lastReadAt?.toISOString() ?? null).toBe(view.lastReadAt);
    expect(row?.createdAt.toISOString()).toBe(view.createdAt);
  });

  it('applies huge tag id lists as one array parameter each', async () => {
    await seed();
    const everything = (await store.run(a, (tx) => tx.query(base))).data;
    const many = Array.from({ length: 70_000 }, () => newId());
    const notIn = await store.run(a, (tx) =>
      tx.query({ ...base, idsNotIn: [...many, everything[0]!.id] }),
    );
    expect(notIn.data.map((c) => c.id)).not.toContain(everything[0]!.id);
    expect(notIn.counts.all).toBe(everything.length - 1);
    const only = await store.run(a, (tx) =>
      tx.query({ ...base, idsIn: [...many, everything[1]!.id] }),
    );
    expect(only.data.map((c) => c.id)).toEqual([everything[1]!.id]);
  });

  it('does not count a resolved conversation as waiting until it is reopened', async () => {
    const [id] = await seed();
    const waiting = () => store.run(a, (tx) => tx.query({ ...base, tab: 'waiting' }));
    await service.update(a, id!, { status: 'open' }, staff);
    const before = await waiting();
    await service.update(a, id!, { status: 'resolved' }, staff);
    const during = await waiting();
    expect(during.data.map((c) => c.id)).not.toContain(id);
    expect(during.counts.waiting).toBe(
      before.counts.waiting - (before.data.some((c) => c.id === id) ? 1 : 0),
    );
    await service.update(a, id!, { status: 'open' }, staff);
    expect((await waiting()).counts).toEqual(before.counts);
  });

  it('runs bulk actions only on conversations of the calling workspace', async () => {
    const ids = await seed();
    const result = await service.bulk(b, { action: 'star', ids }, staff);
    expect(result.succeeded).toBe(0);
    expect(result.data.every((r) => r.code === 'NOT_FOUND')).toBe(true);
    const own = await service.bulk(a, { action: 'star', ids: [ids[0]!] }, staff);
    expect(own.succeeded).toBe(1);
    expect((await service.get(a, ids[0]!)).conversation.starred).toBe(true);
    await service.bulk(a, { action: 'unstar', ids: [ids[0]!] }, staff);
  });

  it('stores the answering bot in its column and drops it when the bot row is removed', async () => {
    const bot = newId();
    await withTenant(tenantDb, a, (tx) =>
      tx
        .insert(schema.bots)
        .values({ id: bot, workspaceId: a, name: 'Bot', industry: 'retail', settings: {} }),
    );
    const base = await channels.getConnection(a, channelId);
    vi.mocked(channels.getConnection).mockResolvedValueOnce({ ...base, botId: bot });
    const c = await service.receive(a, channelId, event('with-bot', 'customer-bot'));
    expect(c.botId).toBe(bot);
    const column = async () =>
      (
        await withTenant(tenantDb, a, (tx) =>
          tx
            .select({ botId: schema.conversations.botId })
            .from(schema.conversations)
            .where(eq(schema.conversations.id, c.id)),
        )
      )[0]?.botId;
    expect(await column()).toBe(bot);

    await withTenant(tenantDb, a, (tx) => tx.delete(schema.bots).where(eq(schema.bots.id, bot)));
    expect((await service.get(a, c.id)).conversation.botId).toBeNull();
    // Saving again must not write the deleted bot back.
    await service.update(a, c.id, { note: 'still here' }, newId());
    expect(await column()).toBeNull();
  });

  it('detaches conversations from a bot that is soft-deleted through the bot lifecycle', async () => {
    const bot = newId();
    await withTenant(tenantDb, a, (tx) =>
      tx
        .insert(schema.bots)
        .values({ id: bot, workspaceId: a, name: 'Bot', industry: 'retail', settings: {} }),
    );
    const base = await channels.getConnection(a, channelId);
    vi.mocked(channels.getConnection).mockResolvedValueOnce({ ...base, botId: bot });
    const c = await service.receive(a, channelId, event('soft-delete', 'customer-soft'));
    expect(c.botId).toBe(bot);

    const lifecycle = new BotLifecycle();
    new ConversationFacadeImpl(
      store,
      channels,
      { getBot: async () => ({}) as BotView },
      fakeTeam(),
      fakeIdentity(),
      fakeCrm() as never,
      lifecycle,
    ).onModuleInit();
    // Another workspace naming the bot changes nothing; its own workspace clears it.
    await lifecycle.beforeDelete(b, bot);
    expect((await service.get(a, c.id)).conversation.botId).toBe(bot);
    await lifecycle.beforeDelete(a, bot);
    expect((await service.get(a, c.id)).conversation.botId).toBeNull();
  });
});
