import { AuthResponse, BootstrapResponse, LODGING_VIDEO_MAX_BYTES } from '@agent-sales/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { signUpVerified } from './support/signup.js';

let app: NestFastifyApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const url = '/api/v1/lodging/media/videos';
const mp4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypisom'),
  Buffer.alloc(32, 1),
]);

function multipart(bytes: Buffer, type = 'video/mp4') {
  const boundary = '----rapiz-video-test';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="tour.mp4"\r\n` +
      `Content-Type: ${type}\r\n\r\n`,
  );
  return {
    payload: Buffer.concat([head, bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function setup(industry = 'hotel') {
  const booted = await createHttpApp(AppModule, { NODE_ENV: 'test', LOG_LEVEL: 'error' });
  app = booted.app;
  await app.init();
  const http = app.getHttpAdapter().getInstance();
  await http.ready();
  const registered = await signUpVerified(app, {
    name: 'Video Owner',
    email: `lodging-video-${industry}@example.test`,
    password: 'correct horse battery',
    workspaceName: 'Video villas',
    industry,
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

describe('HTTP: POST /lodging/media/videos', () => {
  it('requires authentication', async () => {
    const { http } = await setup();
    const body = multipart(mp4);
    const res = await http.inject({ method: 'POST', url, ...body });
    expect(res.statusCode).toBe(401);
  });

  it('answers 404 for a business that is not a hotel', async () => {
    const { http, headers } = await setup('retail');
    const body = multipart(mp4);
    const res = await http.inject({
      method: 'POST',
      url,
      payload: body.payload,
      headers: { ...headers, ...body.headers },
    });
    expect(res.statusCode, res.body).toBe(404);
  });

  it('rejects a file that is not an MP4 with 400 INVALID_VIDEO', async () => {
    const { http, headers } = await setup();
    const body = multipart(Buffer.from('GIF89a not a video'), 'video/mp4');
    const res = await http.inject({
      method: 'POST',
      url,
      payload: body.payload,
      headers: { ...headers, ...body.headers },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json()).toMatchObject({ error: { details: { reason: 'INVALID_VIDEO' } } });
  });

  it('rejects a body that is not multipart with 400 INVALID_VIDEO', async () => {
    const { http, headers } = await setup();
    const res = await http.inject({ method: 'POST', url, headers, payload: { file: 'x' } });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json()).toMatchObject({ error: { details: { reason: 'INVALID_VIDEO' } } });
  });

  it('rejects a video over 25 MB with 413 VIDEO_TOO_LARGE', async () => {
    const { http, headers } = await setup();
    const big = Buffer.concat([mp4, Buffer.alloc(LODGING_VIDEO_MAX_BYTES)]);
    const body = multipart(big);
    const res = await http.inject({
      method: 'POST',
      url,
      payload: body.payload,
      headers: { ...headers, ...body.headers },
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(413);
    expect(res.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { reason: 'VIDEO_TOO_LARGE' } },
    });
  });

  it('answers 503 MEDIA_STORAGE_UNAVAILABLE for a valid MP4 when no storage is configured', async () => {
    const { http, headers } = await setup();
    const body = multipart(mp4);
    const res = await http.inject({
      method: 'POST',
      url,
      payload: body.payload,
      headers: { ...headers, ...body.headers },
    });
    expect(res.statusCode, res.body).toBe(503);
    expect(res.json()).toMatchObject({
      error: { code: 'UNAVAILABLE', details: { reason: 'MEDIA_STORAGE_UNAVAILABLE' } },
    });
  });
});
