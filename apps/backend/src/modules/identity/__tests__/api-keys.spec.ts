import { apiKeyRole, type CreateApiKeyRequest } from '@agent-sales/contracts';
import { userId, type WorkspaceId, workspaceId } from '@agent-sales/shared';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../common/http/api-error.js';
import { REQUIRED_CAPABILITY } from '../../../common/http/auth-context.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import {
  generateApiKey,
  keyPrefix,
  parseApiKey,
  randomToken,
  secretMatches,
} from '../application/api-key-secrets.js';
import { ApiKeyService } from '../application/api-key.service.js';
import { BillingApiPlanGate } from '../application/api-plan-gate.js';
import type { AccountQueries } from '../application/commands/auth.handlers.js';
import type { ApiPlanGate } from '../application/ports/api-keys.js';
import type { AccessTokens } from '../application/ports/security.js';
import type { UserRepository } from '../domain/ports/user.repository.js';
import {
  InMemoryApiKeyStore,
  InMemoryIdempotencyStore,
} from '../infrastructure/persistence/api-keys.in-memory-store.js';
import { InMemoryApiRateLimiter } from '../infrastructure/security/in-memory-rate-limiter.js';
import { apiKeyRouteSet, routeKey } from '../interface/http/api-key-routes.js';
import { AuthGuard } from '../interface/http/auth.guard.js';
import { IdempotencyInterceptor, requestHash } from '../interface/http/idempotency.interceptor.js';

const WS = workspaceId('0190a000-0000-7000-8000-000000000001');
const OTHER_WS = '0190a000-0000-7000-8000-000000000002';
const OWNER = userId('0190a000-0000-7000-8000-0000000000aa');

function setup(
  opts: { role?: string | null; plan?: { enabled: boolean; perMinute: number | null } } = {},
) {
  const store = new InMemoryApiKeyStore();
  const state = {
    role: opts.role === undefined ? 'owner' : opts.role,
    plan: opts.plan ?? { enabled: true, perMinute: 120 },
  };
  const plan: ApiPlanGate = { of: () => Promise.resolve(state.plan) };
  const workspaces = {
    findMembership: () =>
      Promise.resolve(state.role ? { workspaceId: WS, userId: OWNER, role: state.role } : null),
  } as unknown as WorkspaceFacade;
  const users = { findByIds: () => Promise.resolve([]) } as unknown as UserRepository;
  const service = new ApiKeyService(store, plan, workspaces, users);
  return { store, state, service };
}

const input = (over: Partial<CreateApiKeyRequest> = {}): CreateApiKeyRequest => ({
  name: 'Zapier',
  scopes: ['contacts.view', 'contacts.edit'],
  expiresAt: null,
  ...over,
});

describe('API key secrets', () => {
  it('generates rpz_live_<12>_<32> keys whose secret only the stored hash matches', () => {
    const { key, keyId, secretHash } = generateApiKey();
    expect(key).toMatch(/^rpz_live_[A-Za-z0-9]{12}_[A-Za-z0-9]{32}$/);
    const parsed = parseApiKey(key);
    expect(parsed?.keyId).toBe(keyId);
    expect(secretMatches(parsed?.secret ?? '', secretHash)).toBe(true);
    expect(secretMatches('x'.repeat(32), secretHash)).toBe(false);
    expect(secretHash).not.toContain(parsed?.secret ?? '');
    expect(keyPrefix(keyId)).toBe(`rpz_live_${keyId}_…`);
  });

  it('rejects anything that is not a key', () => {
    for (const bad of ['', 'rpz_live_', 'rpz_test_abcdefghijkl_' + 'a'.repeat(32), 'Bearer x'])
      expect(parseApiKey(bad)).toBeNull();
  });

  it('draws uniform alphanumerics', () => {
    expect(randomToken(64)).toMatch(/^[A-Za-z0-9]{64}$/);
    expect(randomToken(16)).not.toBe(randomToken(16));
  });
});

describe('ApiKeyService', () => {
  it('creates a key shown once, lists it without the secret, and verifies it', async () => {
    const { service } = setup();
    const created = await service.create(WS, OWNER, input());
    expect(created.key).toMatch(/^rpz_live_/);
    expect(created.apiKey).toMatchObject({ name: 'Zapier', status: 'active' });
    const [listed] = await service.list(WS);
    expect(JSON.stringify(listed)).not.toContain(created.key.slice(-32));
    const v = await service.verify(created.key);
    expect(v.ok && v.principal).toMatchObject({ workspaceId: WS, userId: OWNER, perMinute: 120 });
  });

  it('refuses keys without the plan, with unknown scopes or a past expiry', async () => {
    await expect(
      setup({ plan: { enabled: false, perMinute: 0 } }).service.create(WS, OWNER, input()),
    ).rejects.toMatchObject({ code: 'FEATURE_LOCKED' });
    const { service } = setup();
    await expect(
      service.create(WS, OWNER, input({ scopes: ['members.manage' as never] })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      service.create(WS, OWNER, input({ expiresAt: '2000-01-01T00:00:00.000Z' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('gives a key scopes ∩ the creator role', async () => {
    const { service, state } = setup();
    const { key } = await service.create(
      WS,
      OWNER,
      input({ scopes: ['contacts.view', 'contacts.edit', 'analytics.view'] }),
    );
    state.role = 'analyst';
    const v = await service.verify(key);
    expect(v.ok && v.principal.capabilities.sort()).toEqual(['analytics.view', 'contacts.view']);
  });

  it('rejects revoked, expired, wrong-secret keys and keys whose creator left', async () => {
    const { service, state } = setup();
    const a = await service.create(WS, OWNER, input());
    expect(await service.verify(a.key.slice(0, -1) + (a.key.endsWith('A') ? 'B' : 'A'))).toEqual({
      ok: false,
      reason: 'unknown',
    });
    const now = new Date();
    const b = await service.create(
      WS,
      OWNER,
      input({ expiresAt: new Date(now.getTime() + 60_000).toISOString() }),
      now,
    );
    expect(await service.verify(b.key, new Date(now.getTime() + 120_000))).toEqual({
      ok: false,
      reason: 'expired',
    });
    await service.revoke(WS, a.apiKey.id);
    expect(await service.verify(a.key)).toEqual({ ok: false, reason: 'revoked' });
    await expect(service.revoke(workspaceId(OTHER_WS), b.apiKey.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(service.revoke(WS, 'not-a-uuid')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    state.role = null;
    expect(await service.verify(b.key)).toEqual({ ok: false, reason: 'not_member' });
  });

  it('writes last_used_at at most once a minute', async () => {
    const { service, store } = setup();
    const { key, apiKey } = await service.create(WS, OWNER, input());
    const t0 = new Date('2030-01-01T00:00:00Z');
    await service.verify(key, t0);
    await service.verify(key, new Date(t0.getTime() + 30_000));
    const [r1] = await store.list(WS);
    expect(r1?.lastUsedAt).toEqual(t0);
    await service.verify(key, new Date(t0.getTime() + 61_000));
    const [r2] = await store.list(WS);
    expect(r2?.lastUsedAt?.getTime()).toBe(t0.getTime() + 61_000);
    expect(r2?.id).toBe(apiKey.id);
  });
});

describe('BillingApiPlanGate', () => {
  const gate = (features: Record<string, boolean>, limits: Record<string, number | null>) =>
    new BillingApiPlanGate({
      entitlements: () => Promise.resolve({ features, limits }),
    } as never);

  it('needs the feature and a non-zero per-minute limit', async () => {
    expect(
      await gate({ 'feature.public_api': true }, { 'api.requests_per_minute': 60 }).of(WS),
    ).toEqual({ enabled: true, perMinute: 60 });
    expect(
      (await gate({ 'feature.public_api': true }, { 'api.requests_per_minute': null }).of(WS))
        .perMinute,
    ).toBeNull();
    expect((await gate({ 'feature.public_api': true }, {}).of(WS)).enabled).toBe(false);
    expect((await gate({}, { 'api.requests_per_minute': 60 }).of(WS)).enabled).toBe(false);
  });
});

describe('InMemoryApiRateLimiter', () => {
  it('counts a fixed window per key and resets after it', async () => {
    let now = 0;
    const limiter = new InMemoryApiRateLimiter(() => now);
    expect(await limiter.hit('k', 2, 60_000)).toEqual({ ok: true, remaining: 1, resetMs: 60_000 });
    expect((await limiter.hit('k', 2, 60_000)).remaining).toBe(0);
    now = 15_000;
    expect(await limiter.hit('k', 2, 60_000)).toEqual({ ok: false, remaining: 0, resetMs: 45_000 });
    expect((await limiter.hit('other', 2, 60_000)).ok).toBe(true);
    now = 60_000;
    expect((await limiter.hit('k', 2, 60_000)).ok).toBe(true);
  });
});

describe('API key routes', () => {
  it('maps contracts to Fastify patterns, only for apiKey routes', () => {
    expect(routeKey('get', '/contacts/{contactId}')).toBe('GET /api/v1/contacts/:contactId');
    const set = apiKeyRouteSet([
      {
        method: 'get',
        path: '/a/{id}',
        apiKey: true,
        summary: '',
        tag: '',
        auth: true,
        responses: {},
      },
      { method: 'get', path: '/b', summary: '', tag: '', auth: true, responses: {} },
    ]);
    expect([...set]).toEqual(['GET /api/v1/a/:id']);
  });
});

// ─── AuthGuard with an API key ────────────────────────────────────────────────

const API_ROUTE = { method: 'GET', url: '/api/v1/contacts/:contactId' };

function context(opts: {
  token: string;
  route?: { method: string; url: string };
  capability?: string;
  headers?: Record<string, string>;
}) {
  const handler = () => undefined;
  if (opts.capability) Reflect.defineMetadata(REQUIRED_CAPABILITY, opts.capability, handler);
  const route = opts.route ?? API_ROUTE;
  const req: Record<string, unknown> = {
    method: route.method,
    url: route.url,
    routeOptions: { url: route.url },
    headers: { authorization: `Bearer ${opts.token}`, ...opts.headers },
  };
  const replyHeaders: Record<string, string> = {};
  const reply = {
    header: (k: string, v: string) => {
      replyHeaders[k] = v;
      return reply;
    },
  };
  const ctx = {
    getHandler: () => handler,
    getClass: () => class {},
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => reply }),
  } as unknown as ExecutionContext;
  return { ctx, req, replyHeaders };
}

async function guardSetup(over: Parameters<typeof setup>[0] = {}) {
  const s = setup(over);
  const created = await s.service.create(WS, OWNER, input());
  const guard = new AuthGuard(
    new Reflector(),
    { verify: () => Promise.resolve(null) } as unknown as AccessTokens,
    {} as WorkspaceFacade,
    {} as AccountQueries,
    s.service,
    new InMemoryApiRateLimiter(),
  );
  return { ...s, guard, key: created.key, id: created.apiKey.id };
}

const rejects = async (p: Promise<unknown>, code: string) => {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ApiError);
  expect((e as ApiError).code).toBe(code);
  return e as ApiError;
};

describe('AuthGuard with an API key', () => {
  it('acts for the creator in the key workspace with the key rights and an audit name', async () => {
    const { guard, key, id } = await guardSetup();
    const { ctx, req, replyHeaders } = context({ token: key, capability: 'contacts.view' });
    expect(await guard.canActivate(ctx)).toBe(true);
    const auth = req['auth'] as {
      userId: string;
      role: string;
      displayName: () => Promise<string>;
      apiKey: unknown;
    };
    expect(req['workspaceId']).toBe(WS);
    expect(auth.userId).toBe(OWNER);
    expect(auth.role).toBe(apiKeyRole(['contacts.edit', 'contacts.view'], 'owner'));
    expect(auth.apiKey).toEqual({ id, name: 'Zapier' });
    expect(await auth.displayName()).toBe('API: Zapier');
    expect(replyHeaders).toMatchObject({
      'X-RateLimit-Limit': '120',
      'X-RateLimit-Remaining': '119',
    });
  });

  it('answers 404 on routes not marked apiKey', async () => {
    const { guard, key } = await guardSetup();
    const { ctx } = context({
      token: key,
      route: { method: 'GET', url: '/api/v1/members' },
      capability: 'members.manage',
    });
    await rejects(guard.canActivate(ctx), 'NOT_FOUND');
  });

  it('answers 401 to an unknown or revoked key', async () => {
    const { guard, key, service, id } = await guardSetup();
    await rejects(
      guard.canActivate(context({ token: 'rpz_live_nope', capability: 'contacts.view' }).ctx),
      'UNAUTHENTICATED',
    );
    await service.revoke(WS, id);
    await rejects(
      guard.canActivate(context({ token: key, capability: 'contacts.view' }).ctx),
      'UNAUTHENTICATED',
    );
  });

  it('answers 404 when X-Workspace-Id names another workspace', async () => {
    const { guard, key } = await guardSetup();
    const { ctx } = context({
      token: key,
      capability: 'contacts.view',
      headers: { 'x-workspace-id': OTHER_WS },
    });
    await rejects(guard.canActivate(ctx), 'NOT_FOUND');
  });

  it('answers 402 when the plan lost the public API', async () => {
    const { guard, key, state } = await guardSetup();
    state.plan = { enabled: false, perMinute: 0 };
    await rejects(
      guard.canActivate(context({ token: key, capability: 'contacts.view' }).ctx),
      'FEATURE_LOCKED',
    );
  });

  it('answers 403 outside the key scopes', async () => {
    const { guard, key } = await guardSetup();
    const e = await rejects(
      guard.canActivate(context({ token: key, capability: 'orders.view' }).ctx),
      'FORBIDDEN',
    );
    expect(e.details).toEqual({ capability: 'orders.view' });
  });

  it('answers 429 with Retry-After past the per-minute limit', async () => {
    const { guard, key } = await guardSetup({ plan: { enabled: true, perMinute: 1 } });
    await guard.canActivate(context({ token: key, capability: 'contacts.view' }).ctx);
    const { ctx, replyHeaders } = context({ token: key, capability: 'contacts.view' });
    await rejects(guard.canActivate(ctx), 'RATE_LIMITED');
    expect(Number(replyHeaders['Retry-After'])).toBeGreaterThan(0);
    expect(replyHeaders['X-RateLimit-Remaining']).toBe('0');
  });
});

// ─── Idempotency-Key ──────────────────────────────────────────────────────────

function idemContext(key: string | undefined, body: unknown, apiKey = true) {
  const reply = {
    statusCode: 201,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    header(k: string, v: string) {
      this.headers[k] = v;
      return this;
    },
  };
  const req = {
    method: 'POST',
    url: '/api/v1/contacts',
    body,
    headers: key ? { 'idempotency-key': key } : {},
    workspaceId: WS as WorkspaceId,
    auth: apiKey
      ? { userId: OWNER, sessionId: 'api-key:k1', apiKey: { id: 'k1', name: 'Zapier' } }
      : { userId: OWNER, sessionId: 's' },
  };
  const ctx = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => reply }),
  } as unknown as ExecutionContext;
  return { ctx, reply };
}

describe('IdempotencyInterceptor', () => {
  const handler = (value: unknown, calls: { n: number }): CallHandler => ({
    handle: () => {
      calls.n += 1;
      return of(value);
    },
  });

  it('replays the first response of a key and runs the handler once', async () => {
    const icpt = new IdempotencyInterceptor(new InMemoryIdempotencyStore());
    const calls = { n: 0 };
    const first = idemContext('k-1', { name: 'A' });
    expect(await firstValueFrom(icpt.intercept(first.ctx, handler({ id: 1 }, calls)))).toEqual({
      id: 1,
    });
    const again = idemContext('k-1', { name: 'A' });
    again.reply.statusCode = 200;
    expect(await firstValueFrom(icpt.intercept(again.ctx, handler({ id: 2 }, calls)))).toEqual({
      id: 1,
    });
    expect(again.reply.statusCode).toBe(201);
    expect(again.reply.headers['Idempotent-Replayed']).toBe('true');
    expect(calls.n).toBe(1);
  });

  it('answers 422 to the same key with another body, and 409 while the first still runs', async () => {
    const store = new InMemoryIdempotencyStore();
    const icpt = new IdempotencyInterceptor(store);
    const hash = requestHash('POST', '/api/v1/contacts', { name: 'A' });
    await store.claim({
      workspaceId: WS,
      apiKeyId: 'k1',
      key: 'busy',
      requestHash: hash,
      expiredBefore: new Date(0),
    });
    const busy = (await firstValueFrom(
      icpt.intercept(idemContext('busy', { name: 'A' }).ctx, handler(1, { n: 0 })),
    ).catch((e: unknown) => e)) as ApiError;
    expect(busy).toMatchObject({ code: 'CONFLICT', details: { reason: 'idempotency_in_flight' } });
    expect(busy.status).toBe(409);
    await firstValueFrom(
      icpt.intercept(idemContext('k-2', { name: 'A' }).ctx, handler(1, { n: 0 })),
    );
    const reused = (await firstValueFrom(
      icpt.intercept(idemContext('k-2', { name: 'B' }).ctx, handler(1, { n: 0 })),
    ).catch((e: unknown) => e)) as ApiError;
    expect(reused).toMatchObject({ details: { reason: 'idempotency_key_reused' } });
    expect(reused.status).toBe(422);
  });

  it('forgets a key whose request failed, so a retry runs again', async () => {
    const icpt = new IdempotencyInterceptor(new InMemoryIdempotencyStore());
    const failing: CallHandler = { handle: () => throwError(() => new Error('boom')) };
    await expect(
      firstValueFrom(icpt.intercept(idemContext('k-3', {}).ctx, failing)),
    ).rejects.toThrow('boom');
    const calls = { n: 0 };
    await firstValueFrom(icpt.intercept(idemContext('k-3', {}).ctx, handler('ok', calls)));
    expect(calls.n).toBe(1);
  });

  it('leaves session requests and requests without the header alone', async () => {
    const icpt = new IdempotencyInterceptor(new InMemoryIdempotencyStore());
    const calls = { n: 0 };
    await firstValueFrom(icpt.intercept(idemContext('k-4', {}, false).ctx, handler(1, calls)));
    await firstValueFrom(icpt.intercept(idemContext('k-4', {}, false).ctx, handler(1, calls)));
    await firstValueFrom(icpt.intercept(idemContext(undefined, {}).ctx, handler(1, calls)));
    expect(calls.n).toBe(3);
  });
});
