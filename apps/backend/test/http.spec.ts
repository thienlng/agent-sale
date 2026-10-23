import {
  allRoutes,
  AuthResponse,
  BootstrapResponse,
  HealthResponse,
  ReadinessResponse,
  WorkspaceDto,
} from '@agent-sales/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';

/** HTTP-level tests through Fastify inject; no DB configured → in-memory adapters. */
let current: NestFastifyApplication | undefined;
const registered: Array<{ method: string; url: string }> = [];

async function app(): Promise<NestFastifyApplication> {
  const booted = await createHttpApp(AppModule, { NODE_ENV: 'test', LOG_LEVEL: 'error' });
  registered.length = 0;
  booted.app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRoute', (r) => {
      for (const m of [r.method].flat())
        registered.push({ method: String(m).toLowerCase(), url: r.url });
    });
  await booted.app.init();
  await booted.app.getHttpAdapter().getInstance().ready();
  current = booted.app;
  return booted.app;
}

type InjectOpts = {
  method: 'GET' | 'POST';
  url: string;
  payload?: Record<string, unknown>;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
};
const inject = (a: NestFastifyApplication, opts: InjectOpts) =>
  a.getHttpAdapter().getInstance().inject(opts);

const signupBody = {
  name: 'Lan',
  email: 'lan@shop.vn',
  password: 'correct horse battery',
  workspaceName: 'Shop Lan',
  industry: 'retail',
};

async function signup(a: NestFastifyApplication, email = signupBody.email) {
  const res = await inject(a, {
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: { ...signupBody, email },
  });
  expect(res.statusCode).toBe(201);
  const body = AuthResponse.parse(res.json());
  const cookie = res.cookies.find((c) => c.name === 'razpi_rt');
  return { token: body.accessToken, cookie, body };
}

async function bootstrap(a: NestFastifyApplication, token: string) {
  const res = await inject(a, {
    method: 'GET',
    url: '/api/v1/bootstrap',
    headers: { authorization: `Bearer ${token}` },
  });
  return BootstrapResponse.parse(res.json());
}

afterEach(async () => {
  await current?.close();
  current = undefined;
});

describe('HTTP: platform', () => {
  it('GET /api/v1/health is public, matches the contract and echoes a request id', async () => {
    const a = await app();
    const res = await inject(a, {
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-request-id': 'req-abc-12345' },
    });
    expect(res.statusCode).toBe(200);
    expect(HealthResponse.safeParse(res.json()).success).toBe(true);
    expect(res.headers['x-request-id']).toBe('req-abc-12345');
  });

  it('generates a request id when a malformed one is sent', async () => {
    const a = await app();
    const res = await inject(a, {
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-request-id': 'bad id!' },
    });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('readiness is ready without a configured database (postgres probe skipped)', async () => {
    const a = await app();
    const res = await inject(a, { method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(ReadinessResponse.parse(res.json()).checks).toEqual([
      { name: 'postgres', status: 'skipped' },
    ]);
  });

  it('GET /metrics (outside the prefix) exposes the latency histogram', async () => {
    const a = await app();
    await inject(a, { method: 'GET', url: '/api/v1/health' });
    const res = await inject(a, { method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('route="/api/v1/health"');
  });

  it('every /api/v1 route is declared in packages/contracts and vice versa', async () => {
    await app();
    const toOpenApi = (url: string) => url.replace(/^\/api\/v1/, '').replace(/:(\w+)/g, '{$1}');
    const served = registered
      .filter((r) => r.url.startsWith('/api/v1/') && r.method !== 'head')
      .map((r) => `${r.method} ${toOpenApi(r.url)}`)
      .sort();
    expect(served).toEqual(allRoutes.map((r) => `${r.method} ${r.path}`).sort());
  });
});

describe('HTTP: auth and tenancy', () => {
  it('protected routes answer 401 without a token; error traceId equals x-request-id', async () => {
    const a = await app();
    const res = await inject(a, { method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { traceId: string } };
    expect(body.error.traceId).toBe(res.headers['x-request-id']);
  });

  it('signup → bootstrap → current workspace, refresh cookie HttpOnly and scoped to /api/v1/auth', async () => {
    const a = await app();
    const { token, cookie, body } = await signup(a);
    expect(body.refreshToken).toBeUndefined();
    expect(cookie).toMatchObject({ httpOnly: true, path: '/api/v1/auth', sameSite: 'Lax' });

    const boot = await bootstrap(a, token);
    expect(boot.memberships).toEqual([
      expect.objectContaining({ workspaceName: 'Shop Lan', role: 'owner' }),
    ]);

    const cur = await inject(a, {
      method: 'GET',
      url: '/api/v1/workspaces/current',
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': boot.memberships[0]?.workspaceId ?? '',
      },
    });
    expect(cur.statusCode).toBe(200);
    expect(WorkspaceDto.parse(cur.json()).name).toBe('Shop Lan');
  });

  it("another user's workspace answers 404, not 403", async () => {
    const a = await app();
    const owner = await signup(a, 'owner@shop.vn');
    const ownerWs = (await bootstrap(a, owner.token)).memberships[0]?.workspaceId ?? '';
    const intruder = await signup(a, 'intruder@shop.vn');
    const res = await inject(a, {
      method: 'GET',
      url: '/api/v1/workspaces/current',
      headers: { authorization: `Bearer ${intruder.token}`, 'x-workspace-id': ownerWs },
    });
    expect(res.statusCode).toBe(404);
  });

  it('cookie refresh rotates the token and rejects foreign origins', async () => {
    const a = await app();
    const { cookie } = await signup(a);
    const ok = await inject(a, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: {},
      headers: { origin: 'http://localhost:5173' },
      cookies: { razpi_rt: cookie?.value ?? '' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.cookies.find((c) => c.name === 'razpi_rt')?.value).not.toBe(cookie?.value);

    const evil = await inject(a, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: {},
      headers: { origin: 'https://evil.example' },
      cookies: { razpi_rt: cookie?.value ?? '' },
    });
    expect(evil.statusCode).toBe(403);
  });

  it('native clients get and send the refresh token in the body', async () => {
    const a = await app();
    const res = await inject(a, {
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { ...signupBody, client: 'native' },
    });
    const { refreshToken } = AuthResponse.parse(res.json());
    expect(refreshToken).toBeTruthy();
    const next = await inject(a, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { client: 'native', refreshToken: refreshToken ?? '' },
    });
    expect(next.statusCode).toBe(200);
  });

  it('logout revokes the session so the refresh cookie stops working', async () => {
    const a = await app();
    const { token, cookie } = await signup(a);
    const out = await inject(a, {
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(out.statusCode).toBe(204);
    const again = await inject(a, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: {},
      cookies: { razpi_rt: cookie?.value ?? '' },
    });
    expect(again.statusCode).toBe(401);
  });

  it('validation errors use the shared envelope', async () => {
    const a = await app();
    const res = await inject(a, {
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });
});
