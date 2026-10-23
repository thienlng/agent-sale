import { HealthResponse } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';

/** HTTP-level smoke test through Fastify inject (no sockets, no DB). */
describe('HTTP', () => {
  async function app() {
    const booted = await createHttpApp(AppModule, { NODE_ENV: 'test', LOG_LEVEL: 'error' });
    await booted.app.init();
    await booted.app.getHttpAdapter().getInstance().ready();
    return booted.app;
  }

  it('GET /api/v1/health matches the contract', async () => {
    const a = await app();
    const res = await a
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(HealthResponse.safeParse(res.json()).success).toBe(true);
    await a.close();
  });

  it('returns the error envelope with a traceId on validation failure', async () => {
    const a = await app();
    const res = await a
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'POST', url: '/api/v1/workspaces', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; traceId?: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.traceId).toBeTruthy();
    await a.close();
  });

  it('GET /workspaces/current without context is 401', async () => {
    const a = await app();
    const res = await a
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/api/v1/workspaces/current' });
    expect(res.statusCode).toBe(401);
    await a.close();
  });
});
