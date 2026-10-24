import type { NormalizedEvent } from '@agent-sales/channels';
import {
  createDb,
  ensureLoginRoles,
  migrate,
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
import { DrizzleConversationStore } from '../infrastructure/persistence/conversation.store.js';

/** The conversation store's SQL on a real Postgres, driven through the facade. */
let pg: TestPostgres;
const handles: { close: () => Promise<void> }[] = [];
let a: WorkspaceId;
let b: WorkspaceId;
const channelId = newId();
let service: ConversationFacadeImpl;
let channels: ChannelFacade;

function open(url: string, max: number): Database {
  const h = createDb({ url, max });
  handles.push(h);
  return h.db;
}

function event(id: string, sender = 'customer-1'): NormalizedEvent {
  return {
    kind: 'facebook',
    assetExternalId: 'page',
    externalEventId: id,
    externalMessageId: id,
    senderExternalId: sender,
    type: 'message',
    occurredAt: new Date(),
    text: `hello ${id}`,
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
  service = new ConversationFacadeImpl(new DrizzleConversationStore(tenant), channels, bots);
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
