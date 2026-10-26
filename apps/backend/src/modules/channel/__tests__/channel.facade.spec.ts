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
      { configured: () => true, authorize: () => '', exchange: async () => [], subscribe: vi.fn() },
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
