import fastifyCookie from '@fastify/cookie';
import {
  AuthResponse,
  BootstrapResponse,
  ConnectionDto,
  IntegrationListResponse,
  KiotVietTestResponse,
  SyncLogResponse,
} from '@agent-sales/contracts';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureEnv } from '../src/common/config.js';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter.js';
import { createLogger } from '../src/common/logger.js';
import { DomainError } from '@agent-sales/shared';
import { CATALOG_SYNC_FACADE, ORDER_PUSH_FACADE } from '../src/modules/commerce/api/index.js';
import { CONTACT_SYNC_FACADE } from '../src/modules/crm/api/index.js';
import { INTEGRATION_STORE } from '../src/modules/integration/application/ports/integration-store.js';
import { KIOTVIET_GATEWAY } from '../src/modules/integration/application/ports/kiotviet-gateway.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../src/modules/workspace/api/index.js';
import {
  KiotVietAuthError,
  KiotVietPermissionError,
  KiotVietUnavailableError,
} from '../src/modules/integration/domain/integration.errors.js';
import { FakeKiotVietGateway } from '../src/modules/integration/__tests__/factories/fake-gateway.js';
import { MemoryIntegrationStore } from '../src/modules/integration/__tests__/factories/memory-integration-store.js';
import { signUpVerified } from './support/signup.js';

let app: NestFastifyApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const creds = { retailer: 'shopdemo', clientId: 'client-1234', clientSecret: 'secret-xyz' };
const settings = { saleBranchIds: [1], orderBranchId: 1, pushOrders: false, syncCustomers: false };

async function setup() {
  configureEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    PUBLIC_WEBHOOK_BASE_URL: 'https://hooks.rapiz.test',
  });
  const store = new MemoryIntegrationStore();
  const gateway = new FakeKiotVietGateway();
  const catalog = {
    previewExternalMatch: async (_ws: unknown, codes: string[]) => ({
      matched: codes.length,
      created: 0,
      rapizOnly: 2,
    }),
    releaseExternalSource: async () => 0,
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(INTEGRATION_STORE)
    .useValue(store)
    .overrideProvider(KIOTVIET_GATEWAY)
    .useValue(gateway)
    .overrideProvider(CATALOG_SYNC_FACADE)
    .useValue(catalog)
    .overrideProvider(ORDER_PUSH_FACADE)
    .useValue(orders)
    .overrideProvider(CONTACT_SYNC_FACADE)
    .useValue(contacts)
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
  const res = await signUpVerified(app, {
    name: 'Owner',
    email: 'kiotviet-owner@example.test',
    password: 'correct horse battery',
    workspaceName: 'Shop',
    industry: 'retail',
  });
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
  const headers = {
    authorization: `Bearer ${auth.accessToken}`,
    'x-workspace-id': boot.memberships[0]?.workspaceId ?? '',
  };
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: object) =>
    http.inject({
      method,
      url: `/api/v1/integrations${path}`,
      headers,
      ...(payload ? { payload } : {}),
    });
  return { http, call, store, gateway, orders };
}

/** What commerce answers when the push of an order has not failed. */
class PushNotFailedError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('The push of this order has not failed', { reason: 'PUSH_NOT_FAILED' });
  }
}

/** The CRM side of the customer switch (no database here). */
const contactCalls: string[] = [];
const contacts = {
  releaseExternalSource: async () => (contactCalls.push('releaseExternalSource'), 0),
  releasePendingContactPushes: async () => (contactCalls.push('releasePending'), 0),
  releaseFailedContactPushes: async () => (contactCalls.push('releaseFailed'), 0),
};

const FAILED_ORDER = '0190f5c2-0000-7000-8000-0000000000f1';
const requeued: string[] = [];
const orders = {
  requeueOrderPush: async (_ws: unknown, orderId: string) => {
    if (orderId !== FAILED_ORDER) throw new PushNotFailedError();
    requeued.push(orderId);
    return 'requeued';
  },
  releasePendingPushes: async () => 0,
};

describe('HTTP: KiotViet order push retry', () => {
  /** A live connection that pushes orders (connected, push on). */
  const pushing = async (call: Awaited<ReturnType<typeof setup>>['call']) => {
    const connected = await call('POST', '/kiotviet', {
      ...creds,
      settings: { ...settings, pushOrders: true },
    });
    expect(connected.statusCode, connected.body).toBe(201);
  };

  it('answers 409 not_pushing when no connection pushes orders', async () => {
    const { call, store } = await setup();
    const none = await call('POST', `/kiotviet/orders/${FAILED_ORDER}/push`);
    expect(none.statusCode).toBe(409);
    expect(none.json()).toMatchObject({
      error: { code: 'CONFLICT', details: { reason: 'not_pushing' } },
    });

    await pushing(call);
    store.connections[0]!.settings.pushOrders = false;
    const off = await call('POST', `/kiotviet/orders/${FAILED_ORDER}/push`);
    expect(off.json()).toMatchObject({ error: { details: { reason: 'not_pushing' } } });
    expect(requeued).toEqual([]);
  });

  it('requeues a failed push with 202 and refuses any other with 409', async () => {
    const { call } = await setup();
    await pushing(call);
    const ok = await call('POST', `/kiotviet/orders/${FAILED_ORDER}/push`);
    expect(ok.statusCode, ok.body).toBe(202);
    expect(requeued).toEqual([FAILED_ORDER]);

    const malformed = await call('POST', '/kiotviet/orders/not-a-uuid/push');
    expect(malformed.statusCode).toBe(400);
    expect(requeued).toEqual([FAILED_ORDER]);

    const refused = await call(
      'POST',
      '/kiotviet/orders/0190f5c2-0000-7000-8000-0000000000f2/push',
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: { details: { reason: 'PUSH_NOT_FAILED' } } });
  });

  it('refuses a member without orders.manage with 403', async () => {
    const { call } = await setup();
    await pushing(call);
    const workspaces = app?.get<WorkspaceFacade>(WORKSPACE_FACADE, { strict: false });
    const real = workspaces?.findMembership.bind(workspaces);
    const spy = vi
      .spyOn(workspaces as WorkspaceFacade, 'findMembership')
      .mockImplementation(async (...args) => {
        const membership = await real?.(...args);
        return membership ? { ...membership, role: 'analyst' } : null;
      });
    const before = requeued.length;
    const forbidden = await call('POST', `/kiotviet/orders/${FAILED_ORDER}/push`);
    spy.mockRestore();
    expect(forbidden.statusCode).toBe(403);
    expect(requeued).toHaveLength(before);
  });
});

describe('HTTP: KiotViet integration', () => {
  it('tests, connects, edits, syncs, reads the log and disconnects', async () => {
    const { http, call, store, gateway } = await setup();

    expect((await http.inject({ method: 'GET', url: '/api/v1/integrations' })).statusCode).toBe(
      401,
    );

    const listed = await call('GET', '');
    expect(listed.statusCode, listed.body).toBe(200);
    expect(IntegrationListResponse.parse(listed.json()).providers[0]).toEqual({
      provider: 'kiotviet',
      available: true,
      connection: null,
    });

    const tested = await call('POST', '/kiotviet/test', creds);
    expect(tested.statusCode, tested.body).toBe(200);
    expect(KiotVietTestResponse.parse(tested.json()).preview).toEqual({
      matched: 3,
      created: 0,
      rapizOnly: 2,
      scanned: 3,
      total: 3,
    });

    const connected = await call('POST', '/kiotviet', { ...creds, settings });
    expect(connected.statusCode, connected.body).toBe(201);
    const dto = ConnectionDto.parse(connected.json());
    expect(dto).toMatchObject({ status: 'syncing', clientIdMasked: '••••1234' });
    expect(connected.body).not.toContain('secret-xyz');
    expect(gateway.webhooks[0]?.url).toBe(
      `https://hooks.rapiz.test/webhooks/kiotviet/${store.connections[0]?.webhookToken}`,
    );

    const again = await call('POST', '/kiotviet', { ...creds, settings });
    expect(again.statusCode).toBe(409);

    const empty = await call('PATCH', '/kiotviet', { version: dto.version });
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { reason: 'nothing_to_update' } },
    });
    const stale = await call('PATCH', '/kiotviet', { version: dto.version - 1, settings });
    expect(stale.statusCode).toBe(409);
    const edited = await call('PATCH', '/kiotviet', {
      version: dto.version,
      settings: { ...settings, pushOrders: true, syncCustomers: true },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(ConnectionDto.parse(edited.json()).settings).toMatchObject({
      pushOrders: true,
      syncCustomers: true,
    });
    // The switch turned on: failed customer pushes get another chance, the import is queued.
    expect(contactCalls).toEqual(['releaseFailed']);
    expect(store.jobs.map((j) => j.kind)).toContain('customer_import');

    // The first import is still open.
    const busy = await call('POST', '/kiotviet/sync');
    expect(busy.statusCode).toBe(409);
    expect(busy.json()).toMatchObject({ error: { details: { reason: 'sync_running' } } });
    store.jobs.forEach((j) => (j.open = false));
    expect((await call('POST', '/kiotviet/sync')).statusCode).toBe(202);

    const log = await call('GET', '/kiotviet/log');
    expect(log.statusCode, log.body).toBe(200);
    expect(SyncLogResponse.parse(log.json()).entries.map((e) => e.code)).toEqual(['connected']);

    // A connection whose connect step failed cannot sync: 409 connect_failed, nothing queued.
    store.jobs.forEach((j) => (j.open = false));
    store.connections[0]!.lastError = { code: 'connect_failed', at: new Date().toISOString() };
    const refused = await call('POST', '/kiotviet/sync');
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: { details: { reason: 'connect_failed' } } });
    expect(store.jobs.filter((j) => j.open)).toEqual([]);

    expect((await call('DELETE', '/kiotviet')).statusCode).toBe(204);
    expect(contactCalls).toEqual(['releaseFailed', 'releaseExternalSource']);
    expect((await call('DELETE', '/kiotviet')).statusCode).toBe(404);
    expect((await call('POST', '/kiotviet/sync')).statusCode).toBe(404);
    expect((await call('GET', '/kiotviet/log')).statusCode).toBe(404);
  });

  it('maps KiotViet errors to 400 with a reason, or 503', async () => {
    const { call, gateway } = await setup();

    expect((await call('POST', '/kiotviet/test', { ...creds, clientId: ' ' })).statusCode).toBe(
      400,
    );

    gateway.fail.branches = new KiotVietAuthError();
    const auth = await call('POST', '/kiotviet/test', creds);
    expect(auth.statusCode).toBe(400);
    expect(auth.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { reason: 'kiotviet_auth' } },
    });

    const retailer = await call('POST', '/kiotviet/test', { ...creds, retailer: 'a.example.com' });
    expect(retailer.json()).toMatchObject({ error: { details: { reason: 'kiotviet_retailer' } } });

    gateway.fail.branches = new KiotVietPermissionError(['branches']);
    const permission = await call('POST', '/kiotviet/test', creds);
    expect(permission.statusCode).toBe(400);
    expect(permission.json()).toMatchObject({
      error: { details: { reason: 'kiotviet_permission', missing: ['branches'] } },
    });

    gateway.fail.branches = new KiotVietUnavailableError();
    const down = await call('POST', '/kiotviet', { ...creds, settings });
    expect(down.statusCode).toBe(503);
    expect(down.json()).toMatchObject({ error: { code: 'UNAVAILABLE' } });

    expect((await call('PATCH', '/kiotviet', { version: 1, settings })).statusCode).toBe(404);
  });
});
