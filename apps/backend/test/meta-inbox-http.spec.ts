import fastifyCookie from '@fastify/cookie';
import {
  AuthResponse,
  BootstrapResponse,
  ConversationDetailDto,
  InboxMessageDto,
} from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureEnv } from '../src/common/config.js';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter.js';
import { createLogger } from '../src/common/logger.js';
import { CHANNEL_STORE } from '../src/modules/channel/application/ports/channel-store.js';
import { META_GATEWAY } from '../src/modules/channel/application/ports/meta-gateway.js';
import { MemoryChannelStore } from '../src/modules/channel/__tests__/factories/memory-channel-store.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../src/modules/workspace/api/index.js';
import { CONVERSATION_STORE } from '../src/modules/conversation/application/ports/conversation-store.js';
import { MemoryConversationStore } from '../src/modules/conversation/__tests__/factories/memory-conversation-store.js';
import {
  CONVERSATION_FACADE,
  type ConversationFacade,
} from '../src/modules/conversation/api/index.js';
let app: NestFastifyApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
async function setup() {
  configureEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' });
  const store = new MemoryChannelStore();
  const inboxStore = new MemoryConversationStore();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CHANNEL_STORE)
    .useValue(store)
    .overrideProvider(CONVERSATION_STORE)
    .useValue(inboxStore)
    .overrideProvider(META_GATEWAY)
    .useValue({
      configured: () => true,
      authorize: () => 'https://www.facebook.com/v24.0/dialog/oauth',
      exchange: async () => [
        { externalId: 'page', name: 'Page', token: 'never-visible', expiresAt: null },
      ],
      subscribe: async () => undefined,
      unsubscribe: async () => undefined,
    })
    .compile();
  app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  await app.register(fastifyCookie);
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter(createLogger('silent')));
  await app.init();
  const http = app.getHttpAdapter().getInstance();
  await http.ready();
  const signup = async (email: string) => {
    const res = await http.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        name: 'Owner',
        email,
        password: 'correct horse battery',
        workspaceName: 'Shop',
        industry: 'retail',
      },
    });
    expect(res.statusCode).toBe(201);
    const auth = AuthResponse.parse(res.json());
    const boot = BootstrapResponse.parse(
      (
        await http.inject({
          method: 'GET',
          url: '/api/v1/bootstrap',
          headers: { authorization: `Bearer ${auth.accessToken}` },
        })
      ).json(),
    );
    return {
      authorization: `Bearer ${auth.accessToken}`,
      'x-workspace-id': boot.memberships[0]?.workspaceId ?? '',
    };
  };
  return { http, signup, store, inbox: module.get<ConversationFacade>(CONVERSATION_FACADE) };
}
describe('HTTP: Meta connections and inbox', () => {
  it('authenticates OAuth start, validates selection and hides discovery across users/workspaces', async () => {
    const { http, signup } = await setup();
    const owner = await signup('meta-owner@example.test'),
      other = await signup('meta-other@example.test');
    expect(
      (await http.inject({ method: 'POST', url: '/api/v1/channels/facebook/connect' })).statusCode,
    ).toBe(401);
    expect(
      (
        await http.inject({
          method: 'POST',
          url: '/api/v1/channels/not-real/connect',
          headers: owner,
        })
      ).statusCode,
    ).toBe(400);
    const start = await http.inject({
      method: 'POST',
      url: '/api/v1/channels/facebook/connect',
      headers: owner,
    });
    expect(start.statusCode).toBe(201);
    const state = (start.json() as { state: string }).state;
    const cookie = start.cookies[0];
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
    const callback = await http.inject({
      method: 'GET',
      url: `/api/v1/channels/oauth/facebook/callback?state=${state}&code=code`,
      cookies: { [cookie?.name ?? '']: cookie?.value ?? '' },
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.headers['cross-origin-opener-policy']).toBe('unsafe-none');
    expect(callback.body).not.toContain('never-visible');
    const match = /"discoveryId":"([a-f0-9-]+)"/.exec(callback.body);
    expect(match).not.toBeNull();
    const id = match?.[1] ?? '';
    expect(
      (
        await http.inject({
          method: 'GET',
          url: `/api/v1/channels/discoveries/${id}`,
          headers: other,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await http.inject({
          method: 'POST',
          url: `/api/v1/channels/discoveries/${id}/select`,
          headers: owner,
          payload: { externalIds: [] },
        })
      ).statusCode,
    ).toBe(400);
    const save = await http.inject({
      method: 'POST',
      url: `/api/v1/channels/discoveries/${id}/select`,
      headers: owner,
      payload: { externalIds: ['page'] },
    });
    expect(save.statusCode).toBe(201);
    expect(save.body).not.toContain('never-visible');
    const connectionId = (save.json() as { data: Array<{ id: string }> }).data[0]?.id ?? '';
    expect(
      (
        await http.inject({
          method: 'PATCH',
          url: `/api/v1/channels/${connectionId}`,
          headers: other,
          payload: { disconnect: true },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await http.inject({
          method: 'GET',
          url: '/api/v1/channels',
          headers: { ...other, 'x-workspace-id': owner['x-workspace-id'] },
        })
      ).statusCode,
    ).toBe(404);
  });
  it('removes a page over DELETE /channels/{id}: auth, validation, tenancy, manage permission (T-133)', async () => {
    const { http, signup } = await setup();
    const owner = await signup('meta-remove-owner@example.test'),
      other = await signup('meta-remove-other@example.test');
    const start = await http.inject({
      method: 'POST',
      url: '/api/v1/channels/facebook/connect',
      headers: owner,
    });
    const state = (start.json() as { state: string }).state;
    const cookie = start.cookies[0];
    const callback = await http.inject({
      method: 'GET',
      url: `/api/v1/channels/oauth/facebook/callback?state=${state}&code=code`,
      cookies: { [cookie?.name ?? '']: cookie?.value ?? '' },
    });
    const discoveryId = /"discoveryId":"([a-f0-9-]+)"/.exec(callback.body)?.[1] ?? '';
    const save = await http.inject({
      method: 'POST',
      url: `/api/v1/channels/discoveries/${discoveryId}/select`,
      headers: owner,
      payload: { externalIds: ['page'] },
    });
    const id = (save.json() as { data: Array<{ id: string }> }).data[0]?.id ?? '';
    const url = `/api/v1/channels/${id}`;
    expect((await http.inject({ method: 'DELETE', url })).statusCode).toBe(401);
    // A member without settings.manage is stopped by the global guard and the page stays.
    const workspaces = app?.get<WorkspaceFacade>(WORKSPACE_FACADE, { strict: false });
    const real = workspaces?.findMembership.bind(workspaces);
    const spy = vi
      .spyOn(workspaces as WorkspaceFacade, 'findMembership')
      .mockImplementationOnce(async (...args) => {
        const membership = await real?.(...args);
        return membership ? { ...membership, role: 'sales' } : null;
      });
    const forbidden = await http.inject({ method: 'DELETE', url, headers: owner });
    expect(forbidden.statusCode).toBe(403);
    spy.mockRestore();
    const kept = await http.inject({ method: 'GET', url: '/api/v1/channels', headers: owner });
    expect((kept.json() as { data: Array<{ id: string }> }).data.map((c) => c.id)).toEqual([id]);
    expect(
      (await http.inject({ method: 'DELETE', url: '/api/v1/channels/not-a-uuid', headers: owner }))
        .statusCode,
    ).toBe(400);
    expect((await http.inject({ method: 'DELETE', url, headers: other })).statusCode).toBe(404);
    const removed = await http.inject({ method: 'DELETE', url, headers: owner });
    expect(removed.statusCode).toBe(204);
    expect(removed.body).toBe('');
    const list = await http.inject({ method: 'GET', url: '/api/v1/channels', headers: owner });
    expect((list.json() as { data: unknown[] }).data).toEqual([]);
    expect((await http.inject({ method: 'DELETE', url, headers: owner })).statusCode).toBe(404);
    const withRemoved = await http.inject({
      method: 'GET',
      url: '/api/v1/channels?includeRemoved=true',
      headers: owner,
    });
    expect((withRemoved.json() as { data: Array<{ id: string; status: string }> }).data).toEqual([
      expect.objectContaining({ id, status: 'removed' }),
    ]);
  });
  it('enforces inbox validation, control, workspace ownership and visible send failure', async () => {
    const { http, signup, store, inbox } = await setup();
    const owner = await signup('inbox-owner@example.test'),
      other = await signup('inbox-other@example.test');
    const ws = owner['x-workspace-id'] as WorkspaceId;
    const channelId = newId();
    store.records.set(channelId, {
      id: channelId,
      workspaceId: ws,
      provider: 'facebook',
      externalId: 'page',
      name: 'Page',
      status: 'connected',
      botId: null,
      tokenSealed: 'not-used',
      expiresAt: null,
      createdAt: new Date().toISOString(),
    });
    const c = await inbox.receive(ws, channelId, {
      kind: 'facebook',
      assetExternalId: 'page',
      senderExternalId: 'customer',
      externalEventId: 'incoming',
      externalMessageId: 'incoming',
      occurredAt: new Date(),
      type: 'message',
      text: 'Hello',
      raw: {},
    });
    await store.update(ws, channelId, { status: 'reauth_required' });
    const url = `/api/v1/conversations/${c.id}`;
    expect((await http.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect((await http.inject({ method: 'GET', url, headers: other })).statusCode).toBe(404);
    expect(
      (await http.inject({ method: 'PATCH', url, headers: other, payload: { note: 'stolen' } }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await http.inject({
          method: 'POST',
          url: `${url}/messages`,
          headers: other,
          payload: { text: 'stolen', idempotencyKey: newId() },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await http.inject({
          method: 'POST',
          url: `${url}/messages`,
          headers: owner,
          payload: { text: '', idempotencyKey: newId() },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await http.inject({ method: 'PATCH', url, headers: owner, payload: { mode: 'bot' } }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await http.inject({
          method: 'PATCH',
          url,
          headers: owner,
          payload: { note: 'Follow up', assignToMe: true, status: 'resolved' },
        })
      ).statusCode,
    ).toBe(200);
    // Done is a folder: staff reopen it before replying.
    const blocked = await http.inject({
      method: 'POST',
      url: `${url}/messages`,
      headers: owner,
      payload: { text: 'Reply', idempotencyKey: newId() },
    });
    expect(blocked.statusCode).toBe(409);
    expect(
      (await http.inject({ method: 'PATCH', url, headers: owner, payload: { status: 'open' } }))
        .statusCode,
    ).toBe(200);
    const sent = await http.inject({
      method: 'POST',
      url: `${url}/messages`,
      headers: owner,
      payload: { text: 'Reply', idempotencyKey: newId() },
    });
    expect(sent.statusCode).toBe(201);
    expect(InboxMessageDto.parse(sent.json())).toMatchObject({
      status: 'failed',
      failureCode: 'reauth_required',
      sender: 'human',
    });
    const detail = ConversationDetailDto.parse(
      (await http.inject({ method: 'GET', url, headers: owner })).json(),
    );
    expect(detail.conversation).toMatchObject({
      note: 'Follow up',
      mode: 'human',
      status: 'open',
    });
    expect(detail.messages).toHaveLength(2);
    const bulk = (headers: Record<string, string>, payload: object) =>
      http.inject({ method: 'POST', url: '/api/v1/conversations/bulk', headers, payload });
    expect((await bulk(owner, { action: 'assign', ids: [c.id] })).statusCode).toBe(400);
    const foreign = await bulk(other, { action: 'spam', ids: [c.id] });
    expect(foreign.statusCode).toBe(200);
    expect(foreign.json()).toMatchObject({ succeeded: 0, failed: 1 });
    const starred = await bulk(owner, { action: 'star', ids: [c.id] });
    expect(starred.json()).toMatchObject({ succeeded: 1, failed: 0 });
    expect(
      (await http.inject({ method: 'GET', url: '/api/v1/conversations?limit=0', headers: owner }))
        .statusCode,
    ).toBe(400);
  });
});
