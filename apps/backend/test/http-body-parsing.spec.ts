import { AuthResponse, BootstrapResponse, BotDto } from '@agent-sales/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { signUpVerified } from './support/signup.js';

/** Request-body parsing errors, through Fastify inject; no DB configured → in-memory adapters. */
let current: NestFastifyApplication | undefined;

async function app(): Promise<NestFastifyApplication> {
  const booted = await createHttpApp(AppModule, { NODE_ENV: 'test', LOG_LEVEL: 'error' });
  current = booted.app;
  await booted.app.init();
  await booted.app.getHttpAdapter().getInstance().ready();
  return booted.app;
}

afterEach(async () => {
  await current?.close();
  current = undefined;
});

const http = (a: NestFastifyApplication) => a.getHttpAdapter().getInstance();

async function owner(a: NestFastifyApplication) {
  const signup = await signUpVerified(a, {
    name: 'Lan',
    email: `body-${Math.random()}@shop.vn`,
    password: 'correct horse battery',
    workspaceName: 'Shop Lan',
    industry: 'retail',
  });
  const authorization = `Bearer ${AuthResponse.parse(signup.json()).accessToken}`;
  const boot = BootstrapResponse.parse(
    (
      await http(a).inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { authorization } })
    ).json(),
  );
  return { authorization, 'x-workspace-id': boot.memberships[0]?.workspaceId ?? '' };
}

describe('request body parsing', () => {
  it('accepts a DELETE that sends content-type application/json with no body', async () => {
    const a = await app();
    const h = await owner(a);
    const bot = BotDto.parse(
      (
        await http(a).inject({
          method: 'POST',
          url: '/api/v1/bots',
          headers: h,
          payload: { name: 'Bot xoa', industry: 'retail' },
        })
      ).json(),
    );
    const res = await http(a).inject({
      method: 'DELETE',
      url: `/api/v1/bots/${bot.id}`,
      headers: { ...h, 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(204);
  });

  it('answers 400 VALIDATION_FAILED in the standard envelope for malformed JSON', async () => {
    const a = await app();
    const h = await owner(a);
    const res = await http(a).inject({
      method: 'POST',
      url: '/api/v1/bots',
      headers: { ...h, 'content-type': 'application/json' },
      payload: '{"name": "Bot",',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: expect.any(String),
        details: { reason: 'INVALID_JSON_BODY' },
        traceId: expect.any(String),
      },
    });
  });

  it('answers 400 VALIDATION_FAILED for a POST with content-type application/json and no body', async () => {
    const a = await app();
    const h = await owner(a);
    const res = await http(a).inject({
      method: 'POST',
      url: '/api/v1/bots',
      headers: { ...h, 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { reason: 'EMPTY_JSON_BODY' },
    });
  });
});
