import { describe, expect, it } from 'vitest';

import type { WorkspaceFacade } from '../../workspace/api/index.js';
import {
  LoginHandler,
  RefreshHandler,
  SignupHandler,
} from '../application/commands/auth.handlers.js';
import type { PasswordHasher } from '../application/ports/security.js';
import { SessionService } from '../application/sessions.js';
import {
  EmailTakenError,
  InvalidCredentialsError,
  SessionInvalidError,
  TooManyAttemptsError,
  WeakPasswordError,
} from '../domain/identity.errors.js';
import {
  InMemorySessionRepository,
  InMemoryUserRepository,
} from '../infrastructure/persistence/identity.in-memory-repositories.js';
import { InMemoryAttemptLimiter } from '../infrastructure/security/in-memory-attempt-limiter.js';
import { JoseAccessTokens } from '../infrastructure/security/jose-access-tokens.js';

/** Fast fake hasher: the real Argon2 adapter is covered by the integration test. */
const hasher: PasswordHasher = {
  hash: async (p) => `h:${p}`,
  verify: async (h, p) => h === `h:${p}`,
  dummyVerify: async () => undefined,
};

async function setup() {
  const users = new InMemoryUserRepository();
  const sessionRepo = new InMemorySessionRepository();
  const tokens = await JoseAccessTokens.create({ NODE_ENV: 'test' });
  const sessions = new SessionService(sessionRepo, tokens);
  const created: string[] = [];
  const workspaces = {
    createWorkspace: async (i: { name: string }) => {
      created.push(i.name);
      return { id: '0', name: i.name, industry: 'retail', timezone: 'x', createdAt: '' };
    },
  } as unknown as WorkspaceFacade;
  const limiter = new InMemoryAttemptLimiter(3, 60_000);
  return {
    users,
    sessionRepo,
    tokens,
    created,
    signup: new SignupHandler(users, hasher, limiter, workspaces, sessions),
    login: new LoginHandler(users, hasher, limiter, sessions),
    refresh: new RefreshHandler(users, sessions),
  };
}

const meta = { userAgent: 'test', ip: '10.0.0.1' };
const input = {
  name: 'Lan',
  email: 'lan@shop.vn',
  password: 'correct horse battery',
  workspaceName: 'Shop Lan',
  industry: 'retail',
  client: 'web' as const,
};

describe('auth flow (in-memory)', () => {
  it('signup creates the user, the first workspace and a verifiable session', async () => {
    const s = await setup();
    const issued = await s.signup.execute(input, meta);
    expect(s.created).toEqual(['Shop Lan']);
    expect(issued.user.email).toBe('lan@shop.vn');
    expect(await s.tokens.verify(issued.accessToken)).toMatchObject({ userId: issued.user.id });
  });

  it('rejects weak passwords and duplicate emails', async () => {
    const s = await setup();
    await expect(s.signup.execute({ ...input, password: 'password' }, meta)).rejects.toBeInstanceOf(
      WeakPasswordError,
    );
    await s.signup.execute(input, meta);
    await expect(
      s.signup.execute({ ...input, email: 'LAN@shop.vn' }, { ...meta, ip: '10.0.0.2' }),
    ).rejects.toBeInstanceOf(EmailTakenError);
  });

  it('login gives the same error for unknown email and wrong password, then rate-limits', async () => {
    const s = await setup();
    await s.signup.execute(input, meta);
    await expect(
      s.login.execute({ email: 'nobody@x.vn', password: 'x', client: 'web' }, meta),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    const wrong = { email: input.email, password: 'wrong-password', client: 'web' as const };
    for (let i = 0; i < 3; i++)
      await expect(s.login.execute(wrong, meta)).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(s.login.execute(wrong, meta)).rejects.toBeInstanceOf(TooManyAttemptsError);
  });

  it('refresh rotates the token; reusing a retired token revokes the whole family', async () => {
    const s = await setup();
    const first = await s.signup.execute(input, meta);
    const second = await s.refresh.execute(first.refreshToken, meta);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    const third = await s.refresh.execute(second.refreshToken, meta);

    await expect(s.refresh.execute(first.refreshToken, meta)).rejects.toMatchObject({
      details: { reason: 'reused' },
    });
    // The legitimate latest token is dead too: the family was revoked.
    await expect(s.refresh.execute(third.refreshToken, meta)).rejects.toBeInstanceOf(
      SessionInvalidError,
    );
  });

  it('refuses a missing or unknown refresh token', async () => {
    const s = await setup();
    await expect(s.refresh.execute(undefined, meta)).rejects.toBeInstanceOf(SessionInvalidError);
    await expect(s.refresh.execute('x'.repeat(43), meta)).rejects.toBeInstanceOf(
      SessionInvalidError,
    );
  });

  it('access tokens are rejected when tampered with', async () => {
    const s = await setup();
    const { accessToken } = await s.signup.execute(input, meta);
    const tampered = accessToken.slice(0, -2) + (accessToken.endsWith('A') ? 'BB' : 'AA');
    expect(await s.tokens.verify(tampered)).toBeNull();
  });
});
