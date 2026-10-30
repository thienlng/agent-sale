import { AuthResponse, BootstrapResponse } from '@agent-sales/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';

let app: NestFastifyApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(8, 1)]);

async function setup() {
  const booted = await createHttpApp(AppModule, { NODE_ENV: 'test', LOG_LEVEL: 'error' });
  app = booted.app;
  await app.init();
  const http = app.getHttpAdapter().getInstance();
  await http.ready();
  const registered = await http.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      name: 'Image Owner',
      email: 'product-image@example.test',
      password: 'correct horse battery',
      workspaceName: 'Image shop',
      industry: 'retail',
    },
  });
  const auth = AuthResponse.parse(registered.json());
  const authorization = `Bearer ${auth.accessToken}`;
  const bootstrap = BootstrapResponse.parse(
    (
      await http.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { authorization } })
    ).json(),
  );
  return {
    http,
    headers: { authorization, 'x-workspace-id': bootstrap.memberships[0]?.workspaceId ?? '' },
  };
}

describe('HTTP: POST /products/images', () => {
  const url = '/api/v1/products/images';

  it('requires authentication', async () => {
    const { http } = await setup();
    const res = await http.inject({
      method: 'POST',
      url,
      payload: { mimeType: 'image/png', base64: png.toString('base64') },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a body that is not a valid upload with 400', async () => {
    const { http, headers } = await setup();
    const res = await http.inject({
      method: 'POST',
      url,
      headers,
      payload: { mimeType: 'image/gif', base64: 'AAAA' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects bad magic bytes with 400 INVALID_IMAGE', async () => {
    const { http, headers } = await setup();
    const res = await http.inject({
      method: 'POST',
      url,
      headers,
      payload: { mimeType: 'image/png', base64: Buffer.from('hello world').toString('base64') },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { reason: 'INVALID_IMAGE' } },
    });
  });

  it('answers 503 MEDIA_STORAGE_UNAVAILABLE when no storage is configured', async () => {
    const { http, headers } = await setup();
    const res = await http.inject({
      method: 'POST',
      url,
      headers,
      payload: { mimeType: 'image/png', base64: png.toString('base64') },
    });
    expect(res.statusCode, res.body).toBe(503);
    expect(res.json()).toMatchObject({
      error: { code: 'UNAVAILABLE', details: { reason: 'MEDIA_STORAGE_UNAVAILABLE' } },
    });
  });
});
