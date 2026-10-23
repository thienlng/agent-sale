import { AuthResponse, BootstrapResponse } from '@agent-sales/contracts';
import { ensureLoginRoles, migrate, withCredentials } from '@agent-sales/db';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';

/** Full app on a real Postgres: Argon2, sessions table, membership guard via app_system. */
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
  method: 'GET' | 'POST';
  url: string;
  payload?: Record<string, unknown>;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}) => app.getHttpAdapter().getInstance().inject(opts);

describe('identity on Postgres', () => {
  it('signup, bootstrap, workspace access and login with the real Argon2 hash', async () => {
    const signup = await inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        name: 'Minh',
        email: 'Minh@Shop.vn',
        password: 'a long enough password',
        workspaceName: 'Minh Store',
        industry: 'retail',
      },
    });
    expect(signup.statusCode).toBe(201);
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
    expect(boot.user.email).toBe('minh@shop.vn');
    const ws = boot.memberships[0]?.workspaceId ?? '';

    const cur = await inject({
      method: 'GET',
      url: '/api/v1/workspaces/current',
      headers: { authorization: `Bearer ${accessToken}`, 'x-workspace-id': ws },
    });
    expect(cur.statusCode).toBe(200);

    const dup = await inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        name: 'X',
        email: 'minh@shop.vn',
        password: 'another long password',
        workspaceName: 'X',
        industry: 'retail',
      },
    });
    expect(dup.statusCode).toBe(409);

    const login = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'MINH@shop.vn', password: 'a long enough password' },
    });
    expect(login.statusCode).toBe(200);
    const bad = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'minh@shop.vn', password: 'wrong password!' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('refresh reuse on the sessions table revokes the family', async () => {
    const signup = await inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        name: 'Hoa',
        email: 'hoa@shop.vn',
        password: 'a long enough password',
        workspaceName: 'Hoa Spa',
        industry: 'spa',
        client: 'native',
      },
    });
    const first = AuthResponse.parse(signup.json()).refreshToken ?? '';
    const r2 = await inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { client: 'native', refreshToken: first },
    });
    const second = AuthResponse.parse(r2.json()).refreshToken ?? '';
    const reuse = await inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { client: 'native', refreshToken: first },
    });
    expect(reuse.statusCode).toBe(401);
    const afterRevoke = await inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { client: 'native', refreshToken: second },
    });
    expect(afterRevoke.statusCode).toBe(401);
  });
});
