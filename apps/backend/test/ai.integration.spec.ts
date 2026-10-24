import {
  AuthResponse,
  BootstrapResponse,
  BotDto,
  LlmProviderDto,
  PlaygroundResponse,
} from '@agent-sales/contracts';
import {
  createDb,
  ensureLoginRoles,
  migrate,
  schema,
  sql,
  withCredentials,
  withSystem,
  withTenant,
} from '@agent-sales/db';
import { workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { DrizzleUserRepository } from '../src/modules/identity/infrastructure/persistence/identity.drizzle-repositories.js';

/** Playground metering (ai_runs, RLS) and platform LLM config (system role, encrypted keys) on Postgres. */
let pg: TestPostgres;
let app: NestFastifyApplication;
let tenantUrl: string;
let systemUrl: string;

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  tenantUrl = withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password);
  systemUrl = withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password);
  const booted = await createHttpApp(AppModule, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: tenantUrl,
    DATABASE_SYSTEM_URL: systemUrl,
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
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  url: string;
  payload?: Record<string, unknown>;
  headers?: Record<string, string>;
}) => app.getHttpAdapter().getInstance().inject(opts);

async function signup(email: string) {
  const res = await inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      name: 'Admin',
      email,
      password: 'a long enough password',
      workspaceName: 'Shop',
      industry: 'retail',
    },
  });
  const { accessToken } = AuthResponse.parse(res.json());
  const boot = BootstrapResponse.parse(
    (
      await inject({
        method: 'GET',
        url: '/api/v1/bootstrap',
        headers: { authorization: `Bearer ${accessToken}` },
      })
    ).json(),
  );
  return { token: accessToken, ws: boot.memberships[0]?.workspaceId ?? '' };
}

describe('ai on Postgres', () => {
  it('meters playground runs in ai_runs under RLS', async () => {
    const { token, ws } = await signup('ai-run@shop.vn');
    const h = { authorization: `Bearer ${token}`, 'x-workspace-id': ws };
    const bot = BotDto.parse(
      (
        await inject({
          method: 'POST',
          url: '/api/v1/bots',
          headers: h,
          payload: { name: 'Bot', industry: 'other' },
        })
      ).json(),
    );
    await inject({
      method: 'POST',
      url: `/api/v1/bots/${bot.id}/faqs`,
      headers: h,
      payload: { question: 'Phí ship bao nhiêu?', answer: 'Dạ phí ship 30.000đ toàn quốc ạ' },
    });
    const res = await inject({
      method: 'POST',
      url: `/api/v1/bots/${bot.id}/playground`,
      headers: h,
      payload: { messages: [{ role: 'customer', content: 'phi ship bao nhieu' }] },
    });
    expect(res.statusCode).toBe(200);
    const body = PlaygroundResponse.parse(res.json());
    expect(body.outcome).toBe('answered');

    const tenant = createDb({ url: tenantUrl, max: 1 });
    try {
      const mine = await withTenant(tenant.db, workspaceId(ws), (tx) =>
        tx.select().from(schema.aiRuns),
      );
      expect(mine).toEqual([
        expect.objectContaining({
          id: body.runId,
          isTest: true,
          outcome: 'answered',
          provider: 'dev-fake',
        }),
      ]);
      expect(mine[0]?.retrieved).toEqual([expect.objectContaining({ used: true })]);
      const other = await signup('other-ws@shop.vn');
      const theirs = await withTenant(tenant.db, workspaceId(other.ws), (tx) =>
        tx.select().from(schema.aiRuns),
      );
      expect(theirs).toEqual([]);
    } finally {
      await tenant.close();
    }
  });

  it('stores providers with an encrypted key and routes tiers, as the system role only', async () => {
    const { token } = await signup('root@razpi.vn');
    const system = createDb({ url: systemUrl, max: 1 });
    try {
      expect(
        await new DrizzleUserRepository(system.db).setPlatformAdmin('root@razpi.vn', true),
      ).toBe(true);
      const h = { authorization: `Bearer ${token}` };
      const created = await inject({
        method: 'POST',
        url: '/api/v1/admin/llm/providers',
        headers: h,
        payload: { name: 'claude', kind: 'anthropic', apiKey: 'sk-ant-very-secret-4321' },
      });
      expect(created.statusCode).toBe(201);
      const provider = LlmProviderDto.parse(created.json());
      const hermes = await inject({
        method: 'POST',
        url: '/api/v1/admin/llm/providers',
        headers: h,
        payload: {
          name: 'hermes',
          kind: 'hermes',
          baseUrl: 'http://127.0.0.1:8788',
          apiKey: 'bridge-key-at-least-thirty-two-chars',
        },
      });
      expect(hermes.statusCode).toBe(201);

      const put = await inject({
        method: 'PUT',
        url: '/api/v1/admin/llm/tiers/pro',
        headers: h,
        payload: {
          primary: { providerId: provider.id, model: 'claude-sonnet-5-5', effort: 'medium' },
          fallback: null,
        },
      });
      expect(put.statusCode).toBe(200);

      const [row] = await withSystem(system.db, (tx) =>
        tx.execute<{ api_key_cipher: string; api_key_hint: string }>(
          sql`select api_key_cipher, api_key_hint from llm_providers where name = 'claude'`,
        ),
      );
      expect(row?.api_key_hint).toBe('4321');
      expect(row?.api_key_cipher.startsWith('v1.')).toBe(true);
      expect(row?.api_key_cipher).not.toContain('secret');

      const routes = await withSystem(system.db, (tx) => tx.select().from(schema.llmTierRoutes));
      expect(routes).toEqual([
        expect.objectContaining({ tier: 'pro', model: 'claude-sonnet-5-5', effort: 'medium' }),
      ]);
    } finally {
      await system.close();
    }
  });
});
