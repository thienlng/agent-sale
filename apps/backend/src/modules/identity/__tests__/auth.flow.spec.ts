import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalMailer } from '../../../common/email/mailer.js';
import { SecretBox } from '../../../common/security/secret-box.js';

import type { AccountFacade } from '../../account/api/index.js';
import type { BillingFacade } from '../../billing/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import {
  LoginHandler,
  PasswordResetHandler,
  RefreshHandler,
  SignupBusinessHandler,
  SignupHandler,
} from '../application/commands/auth.handlers.js';
import { ApiKeyService } from '../application/api-key.service.js';
import { CredentialResetService } from '../application/credential-reset.js';
import { LinkedIdentityService } from '../application/linked-identities.js';
import { StepUpService } from '../application/step-up.js';
import { EmailCodeService, MAX_CODE_ATTEMPTS } from '../application/email-codes.js';
import type { ApiPlanGate } from '../application/ports/api-keys.js';
import type { PasswordHasher } from '../application/ports/security.js';
import { MfaService } from '../application/mfa.service.js';
import { DEFAULT_SESSION_POLICY, SessionStateCache } from '../application/session-state.js';
import { SessionService } from '../application/sessions.js';
import {
  EmailCodeError,
  EmailTakenError,
  InvalidCredentialsError,
  MfaCodeInvalidError,
  MfaReauthError,
  MfaRequiredError,
  SessionInvalidError,
  SignupBusinessDoneError,
  TooManyAttemptsError,
  WeakPasswordError,
} from '../domain/identity.errors.js';
import { totpAt, stepAt } from '../domain/totp.js';
import { User } from '../domain/user.js';
import {
  InMemoryEmailCodeRepository,
  InMemoryExternalIdentityRepository,
  InMemoryMfaRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
} from '../infrastructure/persistence/identity.in-memory-repositories.js';
import { InMemoryAttemptLimiter } from '../infrastructure/security/in-memory-attempt-limiter.js';
import { InMemoryApiKeyStore } from '../infrastructure/persistence/api-keys.in-memory-store.js';
import { JoseAccessTokens } from '../infrastructure/security/jose-access-tokens.js';
import { securityEvents } from './factories/security.js';

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
  const sessions = new SessionService(sessionRepo, tokens, DEFAULT_SESSION_POLICY);
  const created: string[] = [];
  const owners: unknown[] = [];
  const workspaces = {
    createWorkspace: async (i: { name: string; owner?: unknown }) => {
      created.push(i.name);
      owners.push(i.owner);
      return {
        id: '00000000-0000-4000-8000-000000000001',
        name: i.name,
        industry: 'retail',
        timezone: 'x',
        createdAt: '',
      };
    },
    accountOf: async () => 'acc-1',
  } as unknown as WorkspaceFacade;
  const trials: string[] = [];
  const billing = {
    startSignupTrial: async (accountId: string) => {
      if (accountId === 'boom') throw new Error('db down');
      trials.push(accountId);
      return true;
    },
  } as unknown as BillingFacade;
  const ownedAccounts: { accountId: string; name: string; role: 'owner' | 'billing' }[] = [];
  const accounts = {
    listForUser: async () => ownedAccounts,
  } as unknown as AccountFacade;
  const mailer = new LocalMailer('test');
  const codeRepo = new InMemoryEmailCodeRepository();
  const codes = new EmailCodeService(codeRepo, mailer);
  const limiter = new InMemoryAttemptLimiter(3, 60_000);
  const events = securityEvents(users, mailer);
  const identities = new InMemoryExternalIdentityRepository();
  const apiKeyStore = new InMemoryApiKeyStore();
  const plan: ApiPlanGate = { of: () => Promise.resolve({ enabled: true, perMinute: null }) };
  const apiKeys = new ApiKeyService(
    apiKeyStore,
    plan,
    workspaces,
    { findByIds: () => Promise.resolve([]) } as never,
    events.service,
  );
  const mfa = new MfaService(
    new InMemoryMfaRepository(),
    users,
    hasher,
    new InMemoryAttemptLimiter(20, 60_000),
    SecretBox.insecureDevelopmentBox(),
    sessions,
    events.service,
  );
  return {
    mfa,
    codes,
    stepUp: new StepUpService(users, identities, sessions, mfa, codes, events.service),
    linked: new LinkedIdentityService(identities, users, events.service),
    sessions,
    events: events.repo,
    identities,
    apiKeys,
    apiKeyStore,
    users,
    sessionRepo,
    tokens,
    created,
    owners,
    trials,
    workspaces,
    mailer,
    codeRepo,
    ownedAccounts,
    signup: new SignupHandler(users, hasher, limiter, sessions, codes),
    business: new SignupBusinessHandler(users, accounts, workspaces, billing),
    reset: new PasswordResetHandler(
      users,
      hasher,
      new InMemoryAttemptLimiter(3, 60_000),
      sessions,
      codes,
      new CredentialResetService(identities, apiKeys, events.service),
    ),
    login: new LoginHandler(users, hasher, limiter, sessions, mfa),
    refresh: new RefreshHandler(users, sessions),
  };
}

const meta = { userAgent: 'test', ip: '10.0.0.1' };
const input = {
  name: 'Lan',
  email: 'lan@shop.vn',
  password: 'correct horse battery',
  client: 'web' as const,
};
const business = { workspaceName: 'Shop Lan', industry: 'retail' };

/** The code in the latest email (subject "…: 123456"). */
function lastCode(mailer: LocalMailer): string {
  return mailer.sent.at(-1)?.subject.split(': ')[1] ?? '';
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Asks for the signup code, then signs up with it. */
async function signUp(s: Setup, over: Partial<typeof input> = {}, m = meta) {
  const body = { ...input, ...over };
  await s.signup.requestCode({ email: body.email, name: body.name }, m);
  return s.signup.execute({ ...body, code: lastCode(s.mailer) }, m);
}

describe('auth flow (in-memory)', () => {
  it('emails a signup code, then signup with it creates a verified user and no business', async () => {
    const s = await setup();
    await s.signup.requestCode({ email: 'LAN@shop.vn', name: 'Lan' }, meta);
    expect(s.mailer.sent).toHaveLength(1);
    expect(s.mailer.sent[0]?.to).toBe('lan@shop.vn');
    expect(s.mailer.sent[0]?.subject).toContain('đăng ký');
    const code = lastCode(s.mailer);
    expect(code).toMatch(/^\d{6}$/);
    const issued = await s.signup.execute({ ...input, code }, meta);
    expect(s.created).toEqual([]);
    expect(issued.user).toMatchObject({ email: 'lan@shop.vn', emailVerified: true });
    expect(await s.tokens.verify(issued.accessToken)).toMatchObject({ userId: issued.user.id });
  });

  it('refuses signup without a code or with a wrong one', async () => {
    const s = await setup();
    const other = { ...meta, ip: '10.0.0.2' };
    await expect(s.signup.execute({ ...input, code: '123456' }, meta)).rejects.toMatchObject({
      details: { reason: 'code_invalid' },
    });
    await s.signup.requestCode({ email: input.email }, meta);
    const good = lastCode(s.mailer);
    const wrong = good === '111111' ? '222222' : '111111';
    await expect(s.signup.execute({ ...input, code: wrong }, meta)).rejects.toBeInstanceOf(
      EmailCodeError,
    );
    // A code for another address does not work either.
    await expect(
      s.signup.execute({ ...input, email: 'other@shop.vn', code: good }, other),
    ).rejects.toBeInstanceOf(EmailCodeError);
    await expect(s.signup.execute({ ...input, code: good }, other)).resolves.toBeDefined();
    // Used up: it does not sign up anyone else.
    await expect(
      s.signup.execute({ ...input, email: 'x@shop.vn', code: good }, other),
    ).rejects.toBeInstanceOf(EmailCodeError);
  });

  it('kills a code after too many wrong guesses and resends only after the cooldown', async () => {
    const s = await setup();
    const ip = (n: number) => ({ ...meta, ip: `10.0.1.${n}` });
    await s.signup.requestCode({ email: input.email }, meta);
    const good = lastCode(s.mailer);
    const wrong = good === '111111' ? '222222' : '111111';
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++)
      await expect(s.signup.execute({ ...input, code: wrong }, ip(i))).rejects.toMatchObject({
        details: { reason: 'code_invalid' },
      });
    await expect(s.signup.execute({ ...input, code: good }, ip(10))).rejects.toMatchObject({
      details: { reason: 'code_expired' },
    });
    await expect(s.signup.requestCode({ email: input.email }, ip(11))).rejects.toBeInstanceOf(
      TooManyAttemptsError,
    );
    const row = s.codeRepo.rows.values().next().value;
    if (row) row.sentAt = new Date(Date.now() - 61_000);
    await s.signup.requestCode({ email: input.email }, ip(12));
    await expect(
      s.signup.execute({ ...input, code: lastCode(s.mailer) }, ip(13)),
    ).resolves.toBeDefined();
  });

  it('refuses an expired code', async () => {
    const s = await setup();
    await s.signup.requestCode({ email: input.email }, meta);
    const row = s.codeRepo.rows.values().next().value;
    if (row) row.expiresAt = new Date(Date.now() - 1);
    await expect(
      s.signup.execute({ ...input, code: lastCode(s.mailer) }, meta),
    ).rejects.toMatchObject({ details: { reason: 'code_expired' } });
  });

  it('creates the first business with the signup trial, once', async () => {
    const s = await setup();
    const issued = await signUp(s);
    const userId = issued.user.id as never;
    expect(await s.business.execute(userId, business)).toEqual({
      workspaceId: '00000000-0000-4000-8000-000000000001',
    });
    expect(s.created).toEqual(['Shop Lan']);
    expect(s.owners).toEqual([{ name: 'Lan', email: 'lan@shop.vn', phone: null }]);
    expect(s.trials).toEqual(['acc-1']);
    s.ownedAccounts.push({ accountId: 'acc-1', name: 'Shop Lan', role: 'owner' });
    await expect(s.business.execute(userId, business)).rejects.toBeInstanceOf(
      SignupBusinessDoneError,
    );
  });

  it('creates the first business even when the signup trial fails', async () => {
    const s = await setup();
    (s.workspaces as unknown as { accountOf: () => Promise<string> }).accountOf = async () =>
      'boom';
    const issued = await signUp(s);
    await s.business.execute(issued.user.id as never, business);
    expect(s.created).toEqual(['Shop Lan']);
    expect(s.trials).toEqual([]);
  });

  it('resets a forgotten password with the emailed code and signs out everywhere', async () => {
    const s = await setup();
    const issued = await signUp(s);
    await s.reset.forgot({ email: 'nobody@x.vn' }, meta);
    expect(s.mailer.sent).toHaveLength(1);
    await s.reset.forgot({ email: input.email }, meta);
    expect(s.mailer.sent).toHaveLength(2);
    expect(s.mailer.sent[1]?.subject).toContain('đặt lại mật khẩu');
    // A second request within the cooldown looks the same and sends nothing.
    await s.reset.forgot({ email: input.email }, { ...meta, ip: '10.0.0.9' });
    expect(s.mailer.sent).toHaveLength(2);
    const password = 'a brand new passphrase';
    await expect(
      s.reset.reset({ email: input.email, code: '000000', password }, meta),
    ).rejects.toBeInstanceOf(EmailCodeError);
    await s.reset.reset({ email: input.email, code: lastCode(s.mailer), password }, meta);
    await expect(s.refresh.execute(issued.refreshToken, meta)).rejects.toBeInstanceOf(
      SessionInvalidError,
    );
    await expect(
      s.login.execute({ email: input.email, password, client: 'web' }, meta),
    ).resolves.toBeDefined();
  });

  it('rejects weak passwords and duplicate emails', async () => {
    const s = await setup();
    await expect(
      s.signup.execute({ ...input, password: 'password', code: '123456' }, meta),
    ).rejects.toBeInstanceOf(WeakPasswordError);
    await signUp(s);
    const again = { ...meta, ip: '10.0.0.2' };
    await expect(s.signup.requestCode({ email: 'LAN@shop.vn' }, again)).rejects.toBeInstanceOf(
      EmailTakenError,
    );
    await expect(
      s.signup.execute({ ...input, email: 'LAN@shop.vn', code: '123456' }, again),
    ).rejects.toBeInstanceOf(EmailTakenError);
  });

  it('login gives the same error for unknown email and wrong password, then rate-limits', async () => {
    const s = await setup();
    await signUp(s);
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
    const first = await signUp(s);
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
    const { accessToken } = await signUp(s);
    // Change a character inside the signature: the last base64url character carries
    // padding bits the decoder ignores, so editing only that one is not always a change.
    const at = accessToken.length - 10;
    const tampered =
      accessToken.slice(0, at) + (accessToken[at] === 'A' ? 'B' : 'A') + accessToken.slice(at + 1);
    expect(await s.tokens.verify(tampered)).toBeNull();
  });

  describe('two-factor', () => {
    async function enrolled() {
      const s = await setup();
      const issued = await signUp(s);
      const userId = issued.user.id as never;
      const sessionId = currentSession(s);
      const { secret } = await s.mfa.beginSetup(userId, input.password, sessionId);
      const recovery = await s.mfa.enable(userId, totpAt(secret, stepAt(Date.now())), sessionId);
      return { ...s, userId, sessionId, secret, recovery };
    }
    /** The one session signup started. */
    const currentSession = (s: { sessionRepo: InMemorySessionRepository }) =>
      ([...s.sessionRepo.rows.values()][0] as { id: string }).id;
    const creds = { email: input.email, password: input.password, client: 'web' as const };

    it('asks for a code, accepts a good one once, and refuses a replay', async () => {
      const s = await enrolled();
      await expect(s.login.execute(creds, meta)).rejects.toBeInstanceOf(MfaRequiredError);
      await expect(s.login.execute({ ...creds, code: '000000' }, meta)).rejects.toBeInstanceOf(
        MfaCodeInvalidError,
      );
      // The setup code already used the current step; the next step is still inside the window.
      const next = totpAt(s.secret, stepAt(Date.now()) + 1);
      await expect(s.login.execute({ ...creds, code: next }, meta)).resolves.toBeDefined();
      await expect(s.login.execute({ ...creds, code: next }, meta)).rejects.toBeInstanceOf(
        MfaCodeInvalidError,
      );
    });

    it('recovery codes work once each', async () => {
      const s = await enrolled();
      const code = s.recovery[0] as string;
      await expect(s.login.execute({ ...creds, code }, meta)).resolves.toBeDefined();
      await expect(s.login.execute({ ...creds, code }, meta)).rejects.toBeInstanceOf(
        MfaCodeInvalidError,
      );
      expect((await s.mfa.status(s.userId)).recoveryCodesLeft).toBe(s.recovery.length - 1);
    });

    it('turning it off needs the password and a valid code', async () => {
      const s = await enrolled();
      const code = s.recovery[1] as string;
      await expect(
        s.mfa.disable(s.userId, 'wrong password', code, s.sessionId),
      ).rejects.toBeInstanceOf(MfaReauthError);
      await expect(
        s.mfa.disable(s.userId, input.password, '000000', s.sessionId),
      ).rejects.toBeInstanceOf(MfaReauthError);
      await s.mfa.disable(s.userId, input.password, code, s.sessionId);
      expect(await s.mfa.status(s.userId)).toEqual({ enabled: false, recoveryCodesLeft: 0 });
      await expect(s.login.execute(creds, meta)).resolves.toBeDefined();
    });

    it('turning it on signs out every other session but keeps the current one', async () => {
      const s = await setup();
      const mine = await signUp(s);
      const sessionId = currentSession(s);
      const other = await s.login.execute(creds, meta);
      const userId = mine.user.id as never;
      const { secret } = await s.mfa.beginSetup(userId, input.password, sessionId);
      await s.mfa.enable(userId, totpAt(secret, stepAt(Date.now())), sessionId);
      await expect(s.refresh.execute(other.refreshToken, meta)).rejects.toBeInstanceOf(
        SessionInvalidError,
      );
      await expect(s.refresh.execute(mine.refreshToken, meta)).resolves.toBeDefined();
    });

    it('a pending setup does not gate login until confirmed', async () => {
      const s = await setup();
      const issued = await signUp(s);
      await s.mfa.beginSetup(issued.user.id as never, input.password, currentSession(s));
      await expect(s.login.execute(creds, meta)).resolves.toBeDefined();
    });
  });

  describe('session revocation, step-up and linked sign-ins', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** The session id an access token names. */
    async function sid(s: Setup, accessToken: string): Promise<string> {
      return (await s.tokens.verify(accessToken))?.sessionId ?? '';
    }

    it('a logout revokes the session the access token names, at once in this process', async () => {
      const s = await setup();
      const issued = await signUp(s);
      const userId = issued.user.id as never;
      const sessionId = await sid(s, issued.accessToken);
      expect(await s.sessions.state(sessionId)).toMatchObject({ revoked: false, userId });
      await s.sessions.logout(userId, sessionId);
      expect(await s.sessions.state(sessionId)).toMatchObject({ revoked: true });
      await expect(s.refresh.execute(issued.refreshToken, meta)).rejects.toBeInstanceOf(
        SessionInvalidError,
      );
    });

    it('a logout ends earlier rotations of the family too', async () => {
      const s = await setup();
      const first = await signUp(s);
      const second = await s.refresh.execute(first.refreshToken, meta);
      await s.sessions.logout(second.user.id as never, await sid(s, second.accessToken));
      expect(await s.sessions.state(await sid(s, first.accessToken))).toMatchObject({
        revoked: true,
      });
    });

    it('caches session state for the TTL; another process sees a revocation after it', async () => {
      const cache = new SessionStateCache(15_000);
      const state = {
        userId: 'u1' as never,
        revoked: false,
        mfa: false,
        authenticatedAt: null,
        steppedUpAt: null,
      };
      cache.set('s1', state, 0);
      expect(cache.get('s1', 14_999)).toBe(state);
      expect(cache.get('s1', 15_000)).toBeUndefined();
      cache.set('s1', state, 0);
      cache.forgetUser('u1' as never);
      expect(cache.get('s1', 1)).toBeUndefined();
      const off = new SessionStateCache(0);
      off.set('s1', state, 0);
      expect(off.get('s1', 0)).toBeUndefined();
    });

    it('a cached state is not re-read within the TTL, a fresh read sees the change', async () => {
      const s = await setup();
      const issued = await signUp(s);
      const sessionId = await sid(s, issued.accessToken);
      await s.sessions.state(sessionId);
      // Another process revokes it: this process' cache still answers until the TTL.
      await s.sessionRepo.revoke(sessionId, new Date());
      expect(await s.sessions.state(sessionId)).toMatchObject({ revoked: false });
      expect(await s.sessions.state(sessionId, true)).toMatchObject({ revoked: true });
    });

    it('login records the second factor on the session; refresh keeps it', async () => {
      const s = await setup();
      const issued = await signUp(s);
      const userId = issued.user.id as never;
      const sessionId = await sid(s, issued.accessToken);
      expect(await s.sessions.state(sessionId)).toMatchObject({ mfa: false });
      const { secret } = await s.mfa.beginSetup(userId, input.password, sessionId);
      await s.mfa.enable(userId, totpAt(secret, stepAt(Date.now())), sessionId);
      // Turning two-factor on proved the code on this session.
      expect(await s.sessions.state(sessionId, true)).toMatchObject({ mfa: true });
      const code = totpAt(secret, stepAt(Date.now()) + 1);
      const login = await s.login.execute(
        { email: input.email, password: input.password, client: 'web', code },
        meta,
      );
      expect(await s.sessions.state(await sid(s, login.accessToken))).toMatchObject({
        mfa: true,
      });
      const rotated = await s.refresh.execute(login.refreshToken, meta);
      expect(await s.sessions.state(await sid(s, rotated.accessToken))).toMatchObject({
        mfa: true,
      });
    });

    it('a password reset removes linked sign-ins and the user’s API keys, and tells the user', async () => {
      const s = await setup();
      const issued = await signUp(s);
      const userId = issued.user.id as never;
      await s.identities.link(
        { provider: 'google', subject: 'g-1', userId, email: input.email },
        new Date(),
      );
      const ws = '00000000-0000-4000-8000-000000000001' as never;
      const mine = await s.apiKeys.create(ws, userId, {
        name: 'Zapier',
        scopes: [],
        expiresAt: null,
      });
      const theirs = await s.apiKeys.create(ws, '00000000-0000-4000-8000-0000000000bb' as never, {
        name: 'Other member',
        scopes: [],
        expiresAt: null,
      });
      await s.reset.forgot({ email: input.email }, meta);
      await s.reset.reset(
        { email: input.email, code: lastCode(s.mailer), password: 'a brand new passphrase' },
        meta,
      );
      expect(await s.identities.listForUser(userId)).toEqual([]);
      const keys = await s.apiKeyStore.list(ws);
      expect(keys.find((k) => k.id === mine.apiKey.id)?.revokedAt).toBeInstanceOf(Date);
      expect(keys.find((k) => k.id === theirs.apiKey.id)?.revokedAt).toBeNull();
      expect(await s.sessions.state(await sid(s, issued.accessToken))).toMatchObject({
        revoked: true,
      });
      const actions = s.events.rows.filter((e) => e.userId === userId).map((e) => e.action);
      expect(actions).toEqual(
        expect.arrayContaining(['identity.unlinked', 'api_key.revoked', 'password.reset']),
      );
      // The notice names no secret: only that it happened.
      expect(s.mailer.sent.at(-1)?.to).toBe(input.email);
      expect(s.mailer.sent.at(-1)?.text).not.toContain('a brand new passphrase');
    });

    it('step-up: a fresh sign-in counts, then the window closes, then the password reopens it', async () => {
      const s = await setup();
      const issued = await signUp(s);
      const userId = issued.user.id as never;
      const sessionId = await sid(s, issued.accessToken);
      const now = Date.now();
      expect(await s.stepUp.status(userId, sessionId, now)).toMatchObject({
        methods: ['password'],
        recent: true,
        hasPassword: true,
      });
      const later = now + DEFAULT_SESSION_POLICY.stepUpWindowMs + 1;
      expect(await s.stepUp.status(userId, sessionId, later)).toMatchObject({ recent: false });

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(later);
      await expect(
        s.stepUp.verify(userId, sessionId, { password: 'wrong password!' }, null),
      ).rejects.toBeInstanceOf(MfaReauthError);
      const status = await s.stepUp.verify(userId, sessionId, { password: input.password }, null);
      expect(status).toMatchObject({ recent: true, mfa: false });
      expect(s.events.rows.at(-1)).toMatchObject({
        action: 'session.step_up',
        data: { method: 'password' },
      });
    });

    it('step-up with two-factor on takes a code (not the password) and marks the session', async () => {
      const s = await setup();
      const issued = await signUp(s);
      const userId = issued.user.id as never;
      const sessionId = await sid(s, issued.accessToken);
      const { secret } = await s.mfa.beginSetup(userId, input.password, sessionId);
      await s.mfa.enable(userId, totpAt(secret, stepAt(Date.now())), sessionId);
      expect((await s.stepUp.status(userId, sessionId)).methods).toEqual(['totp']);
      await expect(
        s.stepUp.verify(userId, sessionId, { password: input.password }, null),
      ).rejects.toBeInstanceOf(MfaReauthError);
      const code = totpAt(secret, stepAt(Date.now()) + 1);
      await expect(s.stepUp.verify(userId, sessionId, { code }, null)).resolves.toMatchObject({
        recent: true,
        mfa: true,
      });
    });

    it('a Google-only user steps up with an emailed code, then can turn two-factor on', async () => {
      const s = await setup();
      const user = User.registerFromProvider({
        email: 'gg@shop.vn',
        name: 'Google only',
        emailVerifiedAt: new Date(),
      });
      await s.users.insert(user);
      await s.identities.link(
        { provider: 'google', subject: 'g-2', userId: user.id, email: 'gg@shop.vn' },
        new Date(),
      );
      const started = new Date(Date.now() - DEFAULT_SESSION_POLICY.stepUpWindowMs - 60_000);
      const issued = await s.sessions.start(user, meta, {
        assurance: { authenticatedAt: started, mfa: false },
      });
      const sessionId = await sid(s, issued.accessToken);
      expect(await s.stepUp.status(user.id, sessionId)).toMatchObject({
        methods: ['email', 'google'],
        recent: false,
        hasPassword: false,
      });
      // Without a recent step-up there is nothing to check: refuse.
      await expect(s.mfa.beginSetup(user.id, undefined, sessionId)).rejects.toMatchObject({
        details: { reason: 'step_up_required' },
      });
      await s.stepUp.sendCode(user.id);
      expect(s.mailer.sent.at(-1)?.to).toBe('gg@shop.vn');
      await expect(
        s.stepUp.verify(user.id, sessionId, { emailCode: '000000' }, null),
      ).rejects.toBeInstanceOf(EmailCodeError);
      await s.stepUp.verify(user.id, sessionId, { emailCode: lastCode(s.mailer) }, null);
      const { secret } = await s.mfa.beginSetup(user.id, undefined, sessionId);
      await expect(
        s.mfa.enable(user.id, totpAt(secret, stepAt(Date.now())), sessionId),
      ).resolves.not.toHaveLength(0);
      // A user with a password has no emailed step-up.
      const withPassword = await signUp(s);
      await expect(s.stepUp.sendCode(withPassword.user.id as never)).rejects.toBeInstanceOf(
        MfaReauthError,
      );
    });

    it('a Google-only user needs an explicit step-up for two-factor: a fresh sign-in is not enough', async () => {
      const s = await setup();
      const user = User.registerFromProvider({
        email: 'fresh@shop.vn',
        name: 'Google only',
        emailVerifiedAt: new Date(),
      });
      await s.users.insert(user);
      // A sign-in a second ago (what a stolen access token of a new Google session carries).
      const issued = await s.sessions.start(user, meta, {
        assurance: { authenticatedAt: new Date(), mfa: false },
      });
      const sessionId = await sid(s, issued.accessToken);
      const other = await s.sessions.start(user, meta);
      expect(await s.stepUp.status(user.id, sessionId)).toMatchObject({ recent: true });
      await expect(s.mfa.beginSetup(user.id, undefined, sessionId)).rejects.toMatchObject({
        details: { reason: 'step_up_required' },
      });

      await s.stepUp.sendCode(user.id);
      await s.stepUp.verify(user.id, sessionId, { emailCode: lastCode(s.mailer) }, null);
      // The step-up is kept on refresh rotation.
      const rotated = await s.refresh.execute(issued.refreshToken, meta);
      const rotatedId = await sid(s, rotated.accessToken);
      expect((await s.sessions.state(rotatedId, true))?.steppedUpAt).toBeInstanceOf(Date);
      const { secret } = await s.mfa.beginSetup(user.id, undefined, rotatedId);

      // The notice is mailed before the other sessions end.
      const revokeOthers = s.sessions.revokeOthers.bind(s.sessions);
      const sentBefore = s.mailer.sent.length;
      let mailedFirst = false;
      vi.spyOn(s.sessions, 'revokeOthers').mockImplementation(async (u, keep) => {
        mailedFirst = s.mailer.sent.length > sentBefore;
        return revokeOthers(u, keep);
      });
      await s.mfa.enable(user.id, totpAt(secret, stepAt(Date.now())), rotatedId);
      expect(mailedFirst).toBe(true);
      expect(s.mailer.sent.at(-1)?.to).toBe('fresh@shop.vn');
      expect(await s.sessions.state(await sid(s, other.accessToken), true)).toMatchObject({
        revoked: true,
      });
      // Turning two-factor on is not a step-up: it does not set `steppedUpAt` anew.
      const after = await s.sessions.state(rotatedId, true);
      expect(after).toMatchObject({ mfa: true });
    });

    it('lists and removes linked sign-ins, but never the last way in', async () => {
      const s = await setup();
      const user = User.registerFromProvider({
        email: 'gg@shop.vn',
        name: 'Google only',
        emailVerifiedAt: new Date(),
      });
      await s.users.insert(user);
      const link = (subject: string) =>
        s.identities.link(
          { provider: 'google', subject, userId: user.id, email: 'gg@shop.vn' },
          new Date(),
        );
      await link('g-1');
      expect(await s.linked.list(user.id)).toEqual([
        expect.objectContaining({ provider: 'google', subject: 'g-1', email: 'gg@shop.vn' }),
      ]);
      await expect(s.linked.unlink(user.id, 'google', 'g-1', null)).rejects.toMatchObject({
        details: { reason: 'last_sign_in_method' },
      });
      await expect(s.linked.unlink(user.id, 'google', 'nope', null)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await link('g-2');
      await s.linked.unlink(user.id, 'google', 'g-1', '10.0.0.1');
      expect((await s.linked.list(user.id)).map((l) => l.subject)).toEqual(['g-2']);
      expect(s.events.rows.at(-1)).toMatchObject({
        action: 'identity.unlinked',
        ip: '10.0.0.1',
      });
    });

    it('two-factor changes are recorded and emailed', async () => {
      const s = await setup();
      const issued = await signUp(s);
      const userId = issued.user.id as never;
      const sessionId = await sid(s, issued.accessToken);
      const { secret } = await s.mfa.beginSetup(userId, input.password, sessionId);
      const recovery = await s.mfa.enable(userId, totpAt(secret, stepAt(Date.now())), sessionId);
      const sentAfterEnable = s.mailer.sent.length;
      await s.mfa.disable(userId, input.password, recovery[0] as string, sessionId);
      expect(s.mailer.sent.length).toBe(sentAfterEnable + 1);
      expect(s.events.rows.map((e) => e.action)).toEqual(
        expect.arrayContaining(['mfa.enabled', 'mfa.recovery_code_used', 'mfa.disabled']),
      );
    });
  });
});
