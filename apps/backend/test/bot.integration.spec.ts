import { AuthResponse, BootstrapResponse, BotDto } from '@agent-sales/contracts';
import { ensureLoginRoles, migrate, withCredentials } from '@agent-sales/db';
import { workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { KNOWLEDGE_FACADE, type KnowledgeFacade } from '../src/modules/knowledge/api/index.js';

/** Bots + FAQ search on a real Postgres (pg_trgm over folded text, RLS on new tables). */
let pg: TestPostgres;
let app: NestFastifyApplication;

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  const booted = await createHttpApp(AppModule, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    DATABASE_SYSTEM_URL: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
  });
  app = booted.app;
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await pg?.stop();
});

const inject = (opts: {
  method: 'GET' | 'POST' | 'PATCH';
  url: string;
  payload?: Record<string, unknown>;
  headers?: Record<string, string>;
}) => app.getHttpAdapter().getInstance().inject(opts);

describe('bot + knowledge on Postgres', () => {
  it('seeds the industry pack and finds FAQs from unaccented customer text', async () => {
    const signup = await inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        name: 'An',
        email: 'an@shop.vn',
        password: 'a long enough password',
        workspaceName: 'An Shop',
        industry: 'retail',
      },
    });
    const { accessToken } = AuthResponse.parse(signup.json());
    const boot = BootstrapResponse.parse(
      (
        await inject({
          method: 'GET',
          url: '/api/v1/bootstrap',
          headers: { authorization: `Bearer ${accessToken}` },
        })
      ).json(),
    );
    const ws = boot.memberships[0]?.workspaceId ?? '';
    const h = { authorization: `Bearer ${accessToken}`, 'x-workspace-id': ws };

    const bot = BotDto.parse(
      (
        await inject({
          method: 'POST',
          url: '/api/v1/bots',
          headers: h,
          payload: { name: 'An Bot', industry: 'retail' },
        })
      ).json(),
    );

    const knowledge = app.get<KnowledgeFacade>(KNOWLEDGE_FACADE);
    const ship = await knowledge.searchFaqs(workspaceId(ws), bot.id, 'phi ship bao nhieu vay shop');
    expect(ship[0]?.question).toBe('Phí ship bao nhiêu, giao mất mấy ngày?');
    const where = await knowledge.searchFaqs(workspaceId(ws), bot.id, 'cua hang o dau');
    expect(where[0]?.question).toBe('Cửa hàng ở đâu?');
    expect(await knowledge.searchFaqs(workspaceId(ws), bot.id, 'zzz qqq')).toEqual([]);
  });
});
