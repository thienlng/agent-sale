import { AuthResponse, BootstrapResponse } from '@agent-sales/contracts';
import { ensureLoginRoles, migrate, withCredentials } from '@agent-sales/db';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { userId } from '@agent-sales/shared';

import { AppModule } from '../src/app.module.js';
import {
  EXTERNAL_IDENTITY_REPOSITORY,
  type ExternalIdentityRepository,
} from '../src/modules/identity/domain/ports/external-identity.repository.js';
import {
  SECURITY_EVENT_REPOSITORY,
  type SecurityEventRepository,
} from '../src/modules/identity/domain/ports/security-event.repository.js';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../src/modules/identity/domain/ports/user.repository.js';
import { User } from '../src/modules/identity/domain/user.js';
import { createHttpApp } from '../src/bootstrap.js';
import { lastEmailedCode, signupCode, signUpVerified } from './support/signup.js';

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
  it('signup with the emailed code, first business and login with the real Argon2 hash', async () => {
    const minh = { name: 'Minh', email: 'Minh@Shop.vn', password: 'a long enough password' };
    // No code yet: refused before anything is created.
    const noCode = await inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { ...minh, code: '123456' },
    });
    expect(noCode.statusCode).toBe(400);
    expect(noCode.json()).toMatchObject({ error: { details: { reason: 'code_invalid' } } });

    const sent = await inject({
      method: 'POST',
      url: '/api/v1/auth/signup/code',
      payload: { email: minh.email, name: minh.name },
    });
    expect(sent.statusCode).toBe(204);
    const tooSoon = await inject({
      method: 'POST',
      url: '/api/v1/auth/signup/code',
      payload: { email: minh.email },
    });
    expect(tooSoon.statusCode).toBe(429);
    const code = lastEmailedCode(app, 'minh@shop.vn');
    const wrong = await inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { ...minh, code: code === '000000' ? '111111' : '000000' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toMatchObject({ error: { details: { reason: 'code_invalid' } } });

    const signup = await inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      // workspaceName is ignored: the business comes after signup.
      payload: { ...minh, code, workspaceName: 'Minh Store' },
    });
    expect(signup.statusCode).toBe(201);
    const first = AuthResponse.parse(signup.json());
    expect(first.user.emailVerified).toBe(true);
    const auth = { authorization: `Bearer ${first.accessToken}` };

    const boot = BootstrapResponse.parse(
      (await inject({ method: 'GET', url: '/api/v1/bootstrap', headers: auth })).json(),
    );
    expect(boot.user.email).toBe('minh@shop.vn');
    expect(boot.memberships).toEqual([]);

    const created = await inject({
      method: 'POST',
      url: '/api/v1/auth/signup/business',
      headers: auth,
      payload: { workspaceName: 'Minh Store', industry: 'retail' },
    });
    expect(created.statusCode).toBe(201);
    const ws = (created.json() as { workspaceId: string }).workspaceId;
    const again = await inject({
      method: 'POST',
      url: '/api/v1/auth/signup/business',
      headers: auth,
      payload: { workspaceName: 'Minh Store 2', industry: 'retail' },
    });
    expect(again.statusCode).toBe(409);

    const cur = await inject({
      method: 'GET',
      url: '/api/v1/workspaces/current',
      headers: { ...auth, 'x-workspace-id': ws },
    });
    expect(cur.statusCode).toBe(200);
    expect(cur.json()).toMatchObject({ name: 'Minh Store', industry: 'retail' });
    // The business gallery filters by industry and creation time from the bootstrap.
    const listed = BootstrapResponse.parse(
      (await inject({ method: 'GET', url: '/api/v1/bootstrap', headers: auth })).json(),
    ).memberships;
    expect(listed).toEqual([
      expect.objectContaining({
        workspaceId: ws,
        industry: 'retail',
        createdAt: expect.any(String),
      }),
    ]);
    expect(Date.now() - Date.parse(listed[0]!.createdAt!)).toBeLessThan(60_000);

    const taken = await inject({
      method: 'POST',
      url: '/api/v1/auth/signup/code',
      payload: { email: 'minh@shop.vn' },
    });
    expect(taken.statusCode).toBe(409);
    const dup = await inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { name: 'X', email: 'minh@shop.vn', password: 'another long password', code },
    });
    expect(dup.statusCode).toBe(409);

    const login = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'MINH@shop.vn', password: 'a long enough password' },
    });
    expect(login.statusCode).toBe(200);
    expect(AuthResponse.parse(login.json()).user.emailVerified).toBe(true);
    const bad = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'minh@shop.vn', password: 'wrong password!' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('resets a forgotten password with the emailed code', async () => {
    await signUpVerified(app, {
      name: 'Lan',
      email: 'lan@shop.vn',
      password: 'a long enough password',
    });
    const unknown = await inject({
      method: 'POST',
      url: '/api/v1/auth/password/forgot',
      payload: { email: 'nobody@shop.vn' },
    });
    expect(unknown.statusCode).toBe(204);
    const forgot = await inject({
      method: 'POST',
      url: '/api/v1/auth/password/forgot',
      payload: { email: 'lan@shop.vn' },
    });
    expect(forgot.statusCode).toBe(204);
    const reset = await inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: {
        email: 'lan@shop.vn',
        code: lastEmailedCode(app, 'lan@shop.vn'),
        password: 'a brand new passphrase',
      },
    });
    expect(reset.statusCode).toBe(204);
    const oldPassword = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'lan@shop.vn', password: 'a long enough password' },
    });
    expect(oldPassword.statusCode).toBe(401);
    const login = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'lan@shop.vn', password: 'a brand new passphrase' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('refresh reuse on the sessions table revokes the family', async () => {
    const signup = await inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        name: 'Hoa',
        email: 'hoa@shop.vn',
        password: 'a long enough password',
        code: await signupCode(app, 'hoa@shop.vn'),
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

  it('stores Google-only users without a password and links Google accounts by subject', async () => {
    const users = app.get<UserRepository>(USER_REPOSITORY);
    const identities = app.get<ExternalIdentityRepository>(EXTERNAL_IDENTITY_REPOSITORY);
    const lan = User.registerFromProvider({
      email: 'lan.google@gmail.com',
      name: 'Lan',
      emailVerifiedAt: new Date(),
    });
    await users.insert(lan);
    const stored = await users.findById(lan.id);
    expect(stored?.hasPassword).toBe(false);
    expect(stored?.emailVerified).toBe(true);

    const at = new Date();
    await identities.link(
      { provider: 'google', subject: 'sub-lan', userId: lan.id, email: 'lan.google@gmail.com' },
      at,
    );
    expect(await identities.findUserId('google', 'sub-lan')).toBe(lan.id);
    // A later sign-in with a new address keeps the link; another user cannot take the subject.
    await identities.link(
      { provider: 'google', subject: 'sub-lan', userId: lan.id, email: 'lan.new@gmail.com' },
      at,
    );
    const other = User.registerFromProvider({
      email: 'other@gmail.com',
      name: 'O',
      emailVerifiedAt: at,
    });
    await users.insert(other);
    await identities.link(
      { provider: 'google', subject: 'sub-lan', userId: other.id, email: 'x@gmail.com' },
      at,
    );
    expect(await identities.findUserId('google', 'sub-lan')).toBe(lan.id);
    expect(await identities.findUserId('google', 'unknown')).toBeNull();

    // An unverified account linked by email loses its password.
    const squatter = User.register({
      email: 'squat@gmail.com',
      name: 'S',
      passwordHash: 'not-a-real-hash',
    });
    await users.insert(squatter);
    await users.confirmEmail(squatter.id, at, true);
    const confirmed = await users.findById(userId(squatter.id));
    expect(confirmed?.emailVerified).toBe(true);
    expect(confirmed?.hasPassword).toBe(false);
  });

  it('a reset revokes access tokens, removes Google links and records the event (migration 0076)', async () => {
    const res = await signUpVerified(app, {
      name: 'Vy',
      email: 'vy@shop.vn',
      password: 'a long enough password',
    });
    const { accessToken, user } = AuthResponse.parse(res.json());
    const h = { authorization: `Bearer ${accessToken}` };
    expect((await inject({ method: 'GET', url: '/api/v1/me', headers: h })).statusCode).toBe(200);
    const identities = app.get<ExternalIdentityRepository>(EXTERNAL_IDENTITY_REPOSITORY);
    await identities.link(
      { provider: 'google', subject: 'sub-vy', userId: userId(user.id), email: 'vy@shop.vn' },
      new Date(),
    );
    const listed = await inject({ method: 'GET', url: '/api/v1/auth/identities', headers: h });
    expect(listed.json().data).toEqual([
      expect.objectContaining({ provider: 'google', subject: 'sub-vy', email: 'vy@shop.vn' }),
    ]);
    const step = await inject({ method: 'GET', url: '/api/v1/auth/reauth', headers: h });
    expect(step.json()).toMatchObject({ methods: ['password'], recent: true });

    await inject({
      method: 'POST',
      url: '/api/v1/auth/password/forgot',
      payload: { email: 'vy@shop.vn' },
    });
    const reset = await inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: {
        email: 'vy@shop.vn',
        code: lastEmailedCode(app, 'vy@shop.vn'),
        password: 'a brand new passphrase',
      },
    });
    expect(reset.statusCode).toBe(204);
    // The guard checks the session on every request: the old access token is dead at once.
    expect((await inject({ method: 'GET', url: '/api/v1/me', headers: h })).statusCode).toBe(401);
    expect(await identities.findUserId('google', 'sub-vy')).toBeNull();
    const events = await app
      .get<SecurityEventRepository>(SECURITY_EVENT_REPOSITORY)
      .listForUser(userId(user.id), 10);
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining(['password.reset', 'identity.unlinked']),
    );
    expect(events.find((e) => e.action === 'password.reset')?.data).toMatchObject({ unlinked: 1 });
  });
});
