import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { workspaceId } from '@agent-sales/shared';
import { SecretBox } from '../../../common/security/secret-box.js';
import { ChannelModule } from '../channel.module.js';
import { BotLifecycle } from '../../bot/api/index.js';
import { CHANNEL_FACADE } from '../api/index.js';
import { ChannelFacadeImpl } from '../application/channel.facade.impl.js';
import type { MetaGateway } from '../application/ports/meta-gateway.js';
import { MemoryChannelStore } from './factories/memory-channel-store.js';
const ws = workspaceId('018d0000-0000-7000-8000-000000000001'),
  other = workspaceId('018d0000-0000-7000-8000-000000000002');
const user = '018d0000-0000-7000-8000-000000000003';
function setup() {
  const store = new MemoryChannelStore();
  const gateway: MetaGateway = {
    configured: () => true,
    authorize: () => 'https://www.facebook.com/v24.0/dialog/oauth',
    exchange: async () => [
      { externalId: 'page', name: 'Shop Page', token: 'sensitive-token', expiresAt: null },
    ],
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
  };
  const box = SecretBox.insecureDevelopmentBox();
  const service = new ChannelFacadeImpl(store, gateway, box, { getBot: vi.fn() });
  return { store, gateway, box, service };
}
describe('ChannelFacade OAuth contract', () => {
  it('is provided through the module public token', async () => {
    const ref = await Test.createTestingModule({ imports: [ChannelModule] }).compile();
    expect(ref.get(CHANNEL_FACADE)).toBeDefined();
    await ref.close();
  });
  it('requires matching provider and browser, consumes state once and keeps tokens encrypted', async () => {
    const { service, store, box } = setup();
    const { state } = await service.connect(ws, user, 'facebook', 'browser');
    await expect(service.callback('instagram', state, 'browser', 'code')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      service.callback('facebook', state, 'different-browser', 'code'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const discoveryId = await service.callback('facebook', state, 'browser', 'code');
    await expect(service.callback('facebook', state, 'browser', 'code')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const discovery = await service.discovery(ws, user, discoveryId);
    expect(JSON.stringify(discovery)).not.toContain('sensitive-token');
    const result = await service.select(ws, user, discoveryId, ['page']);
    expect(result.data).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('token');
    const row = [...store.records.values()][0];
    expect(row?.tokenSealed).not.toContain('sensitive-token');
    expect(box.open(row?.tokenSealed ?? '')).toBe('sensitive-token');
    await expect(service.select(ws, user, discoveryId, ['page'])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('scopes discoveries and connections to the consenting user and workspace', async () => {
    const { service } = setup();
    const { state } = await service.connect(ws, user, 'facebook', 'browser');
    const id = await service.callback('facebook', state, 'browser', 'code');
    await expect(service.discovery(other, user, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.discovery(ws, 'other-user', id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(service.select(other, user, id, ['page'])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(service.select(ws, user, id, ['ungranted'])).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const result = await service.select(ws, user, id, ['page']);
    const connection = result.data[0];
    expect(connection).toBeDefined();
    await expect(service.getConnection(other, connection?.id ?? '')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      service.update(other, connection?.id ?? '', { disconnect: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await service.list(other)).data).toEqual([]);
  });
  it('consumes cancelled states and rejects expired flows', async () => {
    const { service, store } = setup();
    const { state } = await service.connect(ws, user, 'facebook', 'browser');
    await expect(service.callback('facebook', state, 'browser', null)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(service.callback('facebook', state, 'browser', 'code')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const next = await service.connect(ws, user, 'facebook', 'browser');
    for (const f of store.flows.values()) f.expiresAt = new Date(0);
    await expect(service.callback('facebook', next.state, 'browser', 'code')).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
  });
});
describe('ChannelFacade bot unbinding (T-074)', () => {
  const record = (id: string, workspace: typeof ws, botId: string | null) => ({
    id,
    workspaceId: workspace,
    provider: 'facebook' as const,
    externalId: id,
    name: id,
    status: 'connected' as const,
    botId,
    tokenSealed: 'sealed',
    expiresAt: null,
    createdAt: new Date().toISOString(),
  });
  it('detaches the bot from its pages only, in the same workspace, when the bot is deleted', async () => {
    const store = new MemoryChannelStore();
    const lifecycle = new BotLifecycle();
    const service = new ChannelFacadeImpl(
      store,
      {
        configured: () => true,
        authorize: () => '',
        exchange: async () => [],
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
      },
      SecretBox.insecureDevelopmentBox(),
      { getBot: vi.fn() },
      lifecycle,
    );
    service.onModuleInit();
    store.records.set('a', record('a', ws, 'bot-1'));
    store.records.set('b', record('b', ws, 'bot-2'));
    store.records.set('c', record('c', other, 'bot-1'));
    await lifecycle.beforeDelete(ws, 'bot-1');
    expect(store.records.get('a')?.botId).toBeNull();
    expect(store.records.get('b')?.botId).toBe('bot-2');
    expect(store.records.get('c')?.botId).toBe('bot-1');
  });
});
describe('ChannelFacade.fetchCustomerProfile', () => {
  async function connected() {
    const ctx = setup();
    const { state } = await ctx.service.connect(ws, user, 'facebook', 'browser');
    const discovery = await ctx.service.callback('facebook', state, 'browser', 'code');
    const [connection] = (await ctx.service.select(ws, user, discovery, ['page'])).data;
    return { ...ctx, id: connection?.id ?? '' };
  }
  it('reads the profile with the page token and never exposes the token', async () => {
    const { service, id } = await connected();
    const fake = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        first_name: 'Ha',
        last_name: 'Nguyen',
        profile_pic: 'https://cdn.example/p.jpg',
      }),
    );
    service.transport = fake;
    expect(await service.fetchCustomerProfile(ws, id, 'psid-1')).toEqual({
      name: 'Ha Nguyen',
      avatarUrl: 'https://cdn.example/p.jpg',
    });
    const [url, init] = fake.mock.calls[0] ?? [];
    expect(String(url)).toContain('/psid-1?fields=first_name,last_name,profile_pic');
    expect(String(url)).not.toContain('sensitive-token');
    expect(init?.headers).toEqual({ Authorization: 'Bearer sensitive-token' });
  });
  it('resolves null when Meta refuses, is unreachable or the page is not connected', async () => {
    const { service, id } = await connected();
    service.transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: { code: 100 } }, { status: 400 }))
      .mockRejectedValueOnce(new Error('offline'));
    expect(await service.fetchCustomerProfile(ws, id, 'psid-1')).toBeNull();
    expect(await service.fetchCustomerProfile(ws, id, 'psid-1')).toBeNull();
    await service.update(ws, id, { disconnect: true });
    service.transport = vi.fn<typeof fetch>();
    expect(await service.fetchCustomerProfile(ws, id, 'psid-1')).toBeNull();
    expect(service.transport).not.toHaveBeenCalled();
  });
  it('does not read profiles of another workspace page', async () => {
    const { service, id } = await connected();
    service.transport = vi.fn<typeof fetch>();
    expect(await service.fetchCustomerProfile(other, id, 'psid-1')).toBeNull();
    expect(service.transport).not.toHaveBeenCalled();
  });
});
describe('ChannelFacade website channel (T-098)', () => {
  const site = (status: 'connected' | 'disabled') => ({
    id: 'w',
    workspaceId: ws,
    provider: 'website' as const,
    externalId: 'site-key',
    name: 'Shop site',
    status,
    settings: null,
    botId: null,
    tokenSealed: '',
    expiresAt: null,
    createdAt: new Date().toISOString(),
  });
  it('delivers without a network call and never builds a Meta adapter', async () => {
    const { service, store } = setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const transport = vi.fn();
    service.transport = transport as never;
    store.records.set('w', site('connected'));
    expect(await service.deliver(ws, 'w', 'visitor', { text: 'hi' }, 'k1')).toEqual({
      externalId: null,
      status: 'sent',
      failureCode: null,
    });
    await service.presence(ws, 'w', 'visitor', 'typing_on');
    expect(await service.fetchCustomerProfile(ws, 'w', 'visitor')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it('accepts quick replies for a website visitor without any network call', async () => {
    const { service, store } = setup();
    const transport = vi.fn();
    service.transport = transport as never;
    store.records.set('w', site('connected'));
    const quickReplies = [{ title: '✅ Đặt hàng', payload: 'ORDER_CONFIRM' }];
    expect(
      await service.deliver(ws, 'w', 'visitor', { text: 'Tổng', quickReplies }, 'k1'),
    ).toMatchObject({ status: 'sent' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('fails delivery to a site that is not connected', async () => {
    const { service, store } = setup();
    store.records.set('w', site('disabled'));
    expect(await service.deliver(ws, 'w', 'visitor', { text: 'hi' }, 'k1')).toEqual({
      externalId: null,
      status: 'failed',
      failureCode: 'site_disabled',
    });
  });
});
function patch(store: MemoryChannelStore, id: string, changes: Record<string, unknown>) {
  const record = store.records.get(id);
  if (record) store.records.set(id, { ...record, ...changes });
}
describe('ChannelFacade website lifecycle (T-100)', () => {
  it('enabled toggles only disabled <-> connected and leaves other statuses alone', async () => {
    const { service, store } = setup();
    const { id } = await service.createWebsite(ws, { name: 'Site', domains: ['shop.test'] });
    const status = async (enabled: boolean) =>
      (await service.updateWebsite(ws, id, { enabled })).status;
    expect(await status(false)).toBe('disabled');
    expect(await status(true)).toBe('connected');
    for (const kept of ['disconnected', 'reauth_required'] as const) {
      patch(store, id, { status: kept });
      expect(await status(true)).toBe(kept);
      expect(await status(false)).toBe(kept);
    }
  });
  it('does not resolve a site whose stored settings are unusable (no localhost fallback)', async () => {
    const { service, store } = setup();
    const { id, externalId } = await service.createWebsite(ws, {
      name: 'Site',
      domains: ['shop.test'],
    });
    expect(await service.resolveWebsite(externalId)).not.toBeNull();
    patch(store, id, { settings: null });
    expect(await service.resolveWebsite(externalId)).toBeNull();
  });
  it('signs and verifies visitor tokens from the cache warmed by resolveWebsite', async () => {
    const { service, store } = setup();
    const { externalId } = await service.createWebsite(ws, {
      name: 'Site',
      domains: ['shop.test'],
    });
    const site = await service.resolveWebsite(externalId);
    if (!site) throw new Error('site missing');
    const reads = vi.spyOn(store, 'get');
    const visitor = '018d0000-0000-7000-8000-0000000000aa';
    const token = await service.signVisitorToken(site, visitor);
    expect(await service.verifyVisitorToken(site, token)).toBe(visitor);
    expect(reads).not.toHaveBeenCalled();
  });
});

describe('ChannelFacade page removal (T-133)', () => {
  async function connected(provider: 'facebook' | 'instagram' = 'facebook') {
    const ctx = setup();
    const { state } = await ctx.service.connect(ws, user, provider, 'browser');
    const discoveryId = await ctx.service.callback(provider, state, 'browser', 'code');
    const { data } = await ctx.service.select(ws, user, discoveryId, ['page']);
    return { ...ctx, id: data[0]?.id ?? '' };
  }
  it('soft-removes: hidden from the list, bot unbound, token wiped, row and history kept', async () => {
    const { service, store, gateway, box, id } = await connected();
    await store.update(ws, id, { botId: '018d0000-0000-7000-8000-0000000000b1' });
    await service.remove(ws, id);
    expect((await service.list(ws)).data).toEqual([]);
    // The inbox asks for removed pages too, to keep naming their old conversations.
    expect((await service.list(ws, { includeRemoved: true })).data).toEqual([
      expect.objectContaining({ id, status: 'removed' }),
    ]);
    const row = store.records.get(id);
    expect(row).toMatchObject({ status: 'removed', botId: null });
    expect(box.open(row?.tokenSealed ?? '')).toBe('');
    expect(gateway.unsubscribe).toHaveBeenCalledWith('facebook', {
      externalId: 'page',
      token: 'sensitive-token',
    });
    // The record stays readable by id so old conversations keep their page name.
    await expect(service.getConnection(ws, id)).resolves.toMatchObject({ status: 'removed' });
  });
  it('still removes when Meta cannot be reached or the token is unusable', async () => {
    const { service, store, gateway, id } = await connected();
    vi.mocked(gateway.unsubscribe).mockRejectedValueOnce(new Error('network down'));
    await service.remove(ws, id);
    expect(store.records.get(id)?.status).toBe('removed');
  });
  it('removes a disconnected page that has no usable token', async () => {
    const { service, store, box, id } = await connected();
    await store.update(ws, id, { status: 'disconnected', botId: null });
    const row = store.records.get(id);
    if (row) store.records.set(id, { ...row, tokenSealed: box.seal('') });
    await service.remove(ws, id);
    expect(store.records.get(id)?.status).toBe('removed');
  });
  it('is tenant scoped, refuses website connections and unknown or already removed pages', async () => {
    const { service, id, store } = await connected();
    await expect(service.remove(other, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(store.records.get(id)?.status).toBe('connected');
    const site = await service.createWebsite(ws, { name: 'Site', domains: ['example.com'] });
    await expect(service.remove(ws, site.id)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await service.remove(ws, id);
    await expect(service.remove(ws, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.remove(ws, '018d0000-0000-7000-8000-0000000000ff')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('sends quick replies on a Meta text message in the Graph shape', async () => {
    const { service, id } = await connected();
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message_id: 'm.1' }));
    service.transport = transport;
    const quickReplies = [
      { title: '✅ Đặt hàng', payload: 'ORDER_CONFIRM' },
      { title: '✏️ Sửa thông tin', payload: 'ORDER_EDIT' },
    ];
    await expect(
      service.deliver(ws, id, 'psid', { text: 'Tổng', quickReplies }, 'k'),
    ).resolves.toMatchObject({ status: 'sent', externalId: 'm.1' });
    const body = JSON.parse(String(transport.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ recipient: { id: 'psid' }, messaging_type: 'RESPONSE' });
    expect(body.message).toEqual({
      text: 'Tổng',
      quick_replies: quickReplies.map((q) => ({ content_type: 'text', ...q })),
    });
    const album = [
      { type: 'image' as const, url: 'https://cdn.example/1.jpg' },
      { type: 'image' as const, url: 'https://cdn.example/2.jpg' },
    ];
    transport.mockResolvedValueOnce(Response.json({ message_id: 'm.2' }));
    await service.deliver(ws, id, 'psid', { text: '', attachments: album, quickReplies }, 'k2');
    const albumBody = JSON.parse(String(transport.mock.calls[1]?.[1]?.body));
    expect(albumBody.message.attachments).toHaveLength(2);
    expect(albumBody.message).not.toHaveProperty('quick_replies');
    expect(JSON.stringify(albumBody)).not.toContain('quick_replies');
  });
  it('refuses to deliver for a removed page', async () => {
    const { service, id } = await connected();
    await service.remove(ws, id);
    await expect(service.deliver(ws, id, 'psid', { text: 'hi' }, 'k')).resolves.toMatchObject({
      status: 'failed',
      failureCode: 'page_removed',
    });
  });
  it('writes the removal before calling Meta, and keeps the page when the write fails', async () => {
    const { service, store, gateway, id } = await connected();
    const order: string[] = [];
    const write = store.remove.bind(store);
    vi.spyOn(store, 'remove').mockImplementationOnce(async (...args) => {
      order.push('db');
      return write(...args);
    });
    vi.mocked(gateway.unsubscribe).mockImplementationOnce(async () => {
      order.push('meta');
    });
    await service.remove(ws, id);
    expect(order).toEqual(['db', 'meta']);

    const second = await connected();
    vi.spyOn(second.store, 'remove').mockRejectedValueOnce(new Error('db down'));
    await expect(second.service.remove(ws, second.id)).rejects.toThrow('db down');
    expect(second.gateway.unsubscribe).not.toHaveBeenCalled();
    expect(second.store.records.get(second.id)?.status).toBe('connected');
  });
  it('reconnecting the same page through OAuth reuses the row and shows it again', async () => {
    const { service, store, id } = await connected();
    await service.remove(ws, id);
    const { state } = await service.connect(ws, user, 'facebook', 'browser');
    const discoveryId = await service.callback('facebook', state, 'browser', 'code');
    const { data } = await service.select(ws, user, discoveryId, ['page']);
    expect(data[0]).toMatchObject({ id, status: 'connected' });
    expect(store.records.size).toBe(1);
    expect((await service.list(ws)).data.map((c) => c.id)).toEqual([id]);
  });
});
