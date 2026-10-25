import type { NormalizedEvent } from '@agent-sales/channels';
import {
  createDb,
  ensureLoginRoles,
  migrate,
  eq,
  schema,
  withCredentials,
  withSystem,
  withTenant,
  type Database,
} from '@agent-sales/db';
import { newId, userId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { ChannelFacade } from '../../channel/api/index.js';
import { ConversationFacadeImpl } from '../application/conversation.facade.impl.js';
import { filterConversations, type ConversationFilter } from '../domain/conversation-filter.js';
import { DrizzleConversationStore } from '../infrastructure/persistence/conversation.store.js';
import { fakeIdentity, fakeTeam } from './fakes.js';

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
  service = new ConversationFacadeImpl(store, channels, bots, fakeTeam(), fakeIdentity());
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
    const [c0, c1, c2, c3] = made;
    await service.markRead(a, c0!.id, staff);
    await service.send(a, c1!.id, { text: 'ok', idempotencyKey: newId() }, staff);
    await service.update(a, c2!.id, { status: 'resolved' }, staff);
    await service.update(a, c3!.id, { assigneeId: null, mode: 'human' }, staff);
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
});
