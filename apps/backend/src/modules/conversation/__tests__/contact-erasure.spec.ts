import { ConversationDto, InboxMessageDto } from '@agent-sales/contracts';
import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { PublicObjectStorage } from '../../../common/storage/public-object-storage.js';
import type { ChannelFacade } from '../../channel/api/index.js';
import { ContactLifecycle, type ContactErasure } from '../../crm/api/index.js';
import { ConversationErasure } from '../application/contact-erasure.js';
import type { CustomerMediaStorage } from '../application/ports/customer-media.js';
import { objectKeyOf, S3CustomerMediaStorage } from '../infrastructure/media/s3-customer-media.js';
import { MemoryConversationStore } from './factories/memory-conversation-store.js';

const ws = workspaceId(newId());
const channelId = newId();
const contactId = newId();

function conversation(id: string, customerId: string, contact: string | null) {
  return ConversationDto.parse({
    id,
    channelId,
    provider: 'website',
    customerId,
    customerName: 'Khách',
    mode: 'bot',
    status: 'open',
    assigneeId: null,
    note: '',
    revision: 1,
    lastMessage: 'chào',
    lastInboundAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    contactId: contact,
  });
}

function message(conversationId: string, urls: string[] = []) {
  return InboxMessageDto.parse({
    id: newId(),
    conversationId,
    direction: 'inbound',
    sender: 'customer',
    text: urls.length ? '' : 'số em 0912345678',
    attachments: urls.map((url) => ({ type: 'image', url })),
    status: 'received',
    failureCode: null,
    externalId: null,
    createdAt: '2026-11-01T00:00:00Z',
  });
}

async function seed() {
  const store = new MemoryConversationStore();
  const mine = newId();
  const other = newId();
  await store.run(ws, async (tx) => {
    await tx.save(conversation(mine, 'visitor-1', contactId));
    await tx.save(conversation(other, 'visitor-2', newId()));
    await tx.saveMessage(message(mine), 'm1');
    await tx.saveMessage(message(mine, ['https://cdn.rapiz.io/media/webchat/x.jpg']), 'm2');
    await tx.saveMessage(message(other), 'm3');
  });
  return { store, mine, other };
}

const erasureFor = (): ContactErasure => ({
  workspaceId: ws,
  contactId,
  phoneE164: '+84912345678',
  name: null,
  conversationIds: [],
  counts: { conversations: 0, messages: 0, files: 0, orders: 0, bookings: 0 },
});

describe('ConversationErasure', () => {
  it("collects, then deletes only the customer's conversations, files and raw events", async () => {
    const { store, mine, other } = await seed();
    const removeVisitorUploads = vi.fn(async () => 1);
    const forgetCustomerEvents = vi.fn(async () => 3);
    const lifecycle = new ContactLifecycle();
    const erasure = new ConversationErasure(
      store,
      { forgetCustomerEvents } as unknown as ChannelFacade,
      { removeVisitorUploads } satisfies CustomerMediaStorage,
      lifecycle,
    );
    erasure.onModuleInit();
    const e = erasureFor();

    await lifecycle.beforeDelete(e);

    expect(e.conversationIds).toEqual([mine]);
    expect(e.counts).toMatchObject({ conversations: 1, messages: 2, files: 1 });
    expect(removeVisitorUploads).toHaveBeenCalledWith(ws, [
      'https://cdn.rapiz.io/media/webchat/x.jpg',
    ]);
    expect(forgetCustomerEvents).toHaveBeenCalledWith(ws, channelId, 'visitor-1');
    await store.run(ws, async (tx) => {
      expect(await tx.find(mine)).toBeNull();
      expect(await tx.messages(mine)).toEqual([]);
      expect(await tx.find(other)).not.toBeNull();
      expect(await tx.messages(other)).toHaveLength(1);
    });
  });

  it('does nothing for a customer without conversations, and a retry is harmless', async () => {
    const store = new MemoryConversationStore();
    const removeVisitorUploads = vi.fn(async () => 0);
    const erasure = new ConversationErasure(
      store,
      { forgetCustomerEvents: vi.fn() } as unknown as ChannelFacade,
      { removeVisitorUploads },
    );
    const e = erasureFor();
    await erasure.collect(e);
    await erasure.erase(e);
    expect(e.counts.conversations).toBe(0);
    expect(removeVisitorUploads).not.toHaveBeenCalled();
  });

  it('still finishes when a raw event cleanup fails (the conversations are gone already)', async () => {
    const { store } = await seed();
    const erasure = new ConversationErasure(
      store,
      {
        forgetCustomerEvents: vi.fn(async () => {
          throw new Error('db');
        }),
      } as unknown as ChannelFacade,
      { removeVisitorUploads: async () => 0 },
    );
    const e = erasureFor();
    await erasure.collect(e);
    await expect(erasure.erase(e)).resolves.toBeUndefined();
    expect(e.counts.conversations).toBe(1);
  });
});

describe('S3CustomerMediaStorage', () => {
  const base = 'https://rapiz.io/media';
  const conn = newId();
  const key = (name: string, w: string = ws) => `webchat/${w}/${conn}/${name}`;
  const a = `${newId()}.jpg`,
    b = `${newId()}.png`;
  function storage() {
    const removed: string[] = [];
    const s: PublicObjectStorage = {
      put: async () => '',
      remove: async (k) => {
        if (k.endsWith('fail.jpg')) throw new Error('s3');
        removed.push(k);
      },
      isPublicUrlUnder: (url, prefix) =>
        url.startsWith(`${base}/${prefix}`) || url.startsWith(`/media/${prefix}`),
    };
    return { media: new S3CustomerMediaStorage(s, base), removed };
  }

  it("removes only this workspace's visitor uploads", async () => {
    const { media, removed } = storage();
    const n = await media.removeVisitorUploads(ws, [
      `${base}/${key(a)}`,
      `/media/${key(b)}`,
      `${base}/${key(a)}`,
      `${base}/${key(`${newId()}.jpg`, newId())}`,
      `${base}/products/${ws}/${newId()}.jpg`,
      'https://scontent.xx.fbcdn.net/v/t1/abc.jpg',
    ]);
    expect(removed).toEqual([key(a), key(b)]);
    expect(n).toBe(2);
  });

  it('counts a failed removal out and goes on', async () => {
    const { media, removed } = storage();
    const n = await media.removeVisitorUploads(ws, [
      `${base}/${key('fail.jpg')}`,
      `${base}/${key(a)}`,
    ]);
    expect(n).toBe(1);
    expect(removed).toEqual([key(a)]);
  });

  it('reads object keys from public URLs and media paths', () => {
    expect(objectKeyOf(`${base}/${key(a)}`, base)).toBe(key(a));
    expect(objectKeyOf(`/media/${key(a)}`, base)).toBe(key(a));
    expect(objectKeyOf(`https://old-tunnel.example/media/${key(a)}`, base)).toBe(key(a));
    expect(objectKeyOf('https://elsewhere.example/x.jpg', base)).toBeNull();
  });
});
