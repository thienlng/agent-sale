import { AuthResponse, BootstrapResponse, BotDto } from '@agent-sales/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { workspaceId } from '@agent-sales/shared';
import { Bot } from '../src/modules/bot/domain/bot.js';
import {
  BOT_UOW,
  type BotUnitOfWork,
} from '../src/modules/bot/application/ports/bot-unit-of-work.js';
import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';

let app: NestFastifyApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function setup(industry: string) {
  const booted = await createHttpApp(AppModule, { NODE_ENV: 'test', LOG_LEVEL: 'error' });
  app = booted.app;
  await app.init();
  const http = app.getHttpAdapter().getInstance();
  await http.ready();
  const registered = await http.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      name: 'Industry Owner',
      email: 'industry@example.test',
      password: 'correct horse battery',
      workspaceName: 'Hotel business',
      industry,
    },
  });
  const auth = AuthResponse.parse(registered.json());
  const authorization = `Bearer ${auth.accessToken}`;
  const bootstrap = BootstrapResponse.parse(
    (
      await http.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { authorization } })
    ).json(),
  );
  const headers = { authorization, 'x-workspace-id': bootstrap.memberships[0]?.workspaceId ?? '' };
  return { http, headers };
}

describe('HTTP: bot industry follows the selected business', () => {
  it('rejects a contradictory pack without creating or seeding a bot', async () => {
    const { http, headers } = await setup('hotel');
    const rejected = await http.inject({
      method: 'POST',
      url: '/api/v1/bots',
      headers,
      payload: { name: 'Wrong pack', industry: 'retail' },
    });
    expect(rejected.statusCode, rejected.body).toBe(400);
    expect(rejected.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect((await http.inject({ method: 'GET', url: '/api/v1/bots', headers })).json()).toEqual({
      data: [],
    });
  });

  it('uses the selected business pack and rejects a foreign workspace header', async () => {
    const { http, headers } = await setup('hotel');
    const created = await http.inject({
      method: 'POST',
      url: '/api/v1/bots',
      headers,
      payload: { name: 'Hotel assistant', industry: 'hotel' },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(BotDto.parse(created.json()).industry).toBe('hotel');
    const foreign = await http.inject({
      method: 'POST',
      url: '/api/v1/bots',
      headers: { ...headers, 'x-workspace-id': crypto.randomUUID() },
      payload: { name: 'Other business', industry: 'hotel' },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('does not silently map an unsupported legacy industry to another pack', async () => {
    const { http, headers } = await setup('legacy-rooms');
    const rejected = await http.inject({
      method: 'POST',
      url: '/api/v1/bots',
      headers,
      payload: { name: 'Generic fallback', industry: 'other' },
    });
    expect(rejected.statusCode, rejected.body).toBe(400);
    expect((await http.inject({ method: 'GET', url: '/api/v1/bots', headers })).json()).toEqual({
      data: [],
    });
  });
});

it('keeps ordinary edits of legacy bots available without changing their original pack', async () => {
  const { http, headers } = await setup('hotel');
  const ws = workspaceId(headers['x-workspace-id']);
  const bot = Bot.create({ workspaceId: ws, name: 'Legacy retail bot', industry: 'retail' });
  if (!app) throw new Error('Test application was not initialized');
  const uow = app.get<BotUnitOfWork>(BOT_UOW, { strict: false });
  await uow.run(ws, ({ bots }) => bots.save(bot));
  const updated = await http.inject({
    method: 'PATCH',
    url: `/api/v1/bots/${bot.id}`,
    headers,
    payload: { name: 'Kept legacy bot' },
  });
  expect(updated.statusCode, updated.body).toBe(200);
  expect(BotDto.parse(updated.json())).toMatchObject({
    name: 'Kept legacy bot',
    industry: 'retail',
  });
});
