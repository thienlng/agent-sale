import { allRoutes, HealthResponse, ReadinessResponse } from '@agent-sales/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';

/** HTTP-level tests through Fastify inject (no sockets, no DB). */
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
};
const inject = (a: NestFastifyApplication, opts: InjectOpts) =>
  a.getHttpAdapter().getInstance().inject(opts);

afterEach(async () => {
  await current?.close();
  current = undefined;
});

describe('HTTP', () => {
  it('GET /api/v1/health matches the contract and echoes a request id', async () => {
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

  it('generates a request id when none (or a malformed one) is sent', async () => {
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
    const body = ReadinessResponse.parse(res.json());
    expect(body.checks).toEqual([{ name: 'postgres', status: 'skipped' }]);
  });

  it('error envelope carries the same traceId as the x-request-id header', async () => {
    const a = await app();
    const res = await inject(a, {
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; traceId?: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.traceId).toBe(res.headers['x-request-id']);
  });

  it('GET /workspaces/current without context is 401', async () => {
    const a = await app();
    const res = await inject(a, { method: 'GET', url: '/api/v1/workspaces/current' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /metrics (outside the prefix) exposes the latency histogram', async () => {
    const a = await app();
    await inject(a, { method: 'GET', url: '/api/v1/health' });
    const res = await inject(a, { method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('http_request_duration_seconds_bucket');
    expect(res.body).toContain('route="/api/v1/health"');
  });

  it('serves an OpenAPI 3.1 document', async () => {
    const a = await app();
    const res = await inject(a, { method: 'GET', url: '/api/v1/openapi.json' });
    expect((res.json() as { openapi: string }).openapi).toBe('3.1.0');
  });

  it('every /api/v1 route is declared in packages/contracts and vice versa', async () => {
    await app();
    const toOpenApi = (url: string) => url.replace(/^\/api\/v1/, '').replace(/:(\w+)/g, '{$1}');
    const served = registered
      .filter((r) => r.url.startsWith('/api/v1/') && r.method !== 'head')
      .map((r) => `${r.method} ${toOpenApi(r.url)}`)
      .sort();
    const declared = allRoutes.map((r) => `${r.method} ${r.path}`).sort();
    expect(served).toEqual(declared);
  });
});
