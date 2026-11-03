import { describe, expect, it } from 'vitest';

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
import { EmailCodeService, MAX_CODE_ATTEMPTS } from '../application/email-codes.js';
import type { PasswordHasher } from '../application/ports/security.js';
import { MfaService } from '../application/mfa.service.js';
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
import {
  InMemoryEmailCodeRepository,
  InMemoryMfaRepository,
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
  const mfa = new MfaService(
    new InMemoryMfaRepository(),
    users,
    hasher,
    new InMemoryAttemptLimiter(20, 60_000),
    SecretBox.insecureDevelopmentBox(),
    sessions,
  );
  return {
    mfa,
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
      const { secret } = await s.mfa.beginSetup(userId, input.password);
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
      const { secret } = await s.mfa.beginSetup(userId, input.password);
      await s.mfa.enable(userId, totpAt(secret, stepAt(Date.now())), sessionId);
      await expect(s.refresh.execute(other.refreshToken, meta)).rejects.toBeInstanceOf(
        SessionInvalidError,
      );
      await expect(s.refresh.execute(mine.refreshToken, meta)).resolves.toBeDefined();
    });

    it('a pending setup does not gate login until confirmed', async () => {
      const s = await setup();
      const issued = await signUp(s);
      await s.mfa.beginSetup(issued.user.id as never, input.password);
      await expect(s.login.execute(creds, meta)).resolves.toBeDefined();
    });
  });
});
