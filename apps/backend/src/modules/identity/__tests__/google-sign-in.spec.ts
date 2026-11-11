import { describe, expect, it } from 'vitest';

import { SecretBox } from '../../../common/security/secret-box.js';

import { GoogleSignInService, safeRedirect } from '../application/google-sign-in.js';
import { LoginHandler } from '../application/commands/auth.handlers.js';
import { MfaService } from '../application/mfa.service.js';
import type { GoogleOAuthClient, GoogleProfile } from '../application/ports/google-oauth.js';
import type { PasswordHasher } from '../application/ports/security.js';
import { SessionService } from '../application/sessions.js';
import {
  GoogleSignInError,
  InvalidCredentialsError,
  MfaCodeInvalidError,
} from '../domain/identity.errors.js';
import { stepAt, totpAt } from '../domain/totp.js';
import { User } from '../domain/user.js';
import {
  InMemoryExternalIdentityRepository,
  InMemoryMfaRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
} from '../infrastructure/persistence/identity.in-memory-repositories.js';
import { InMemoryAttemptLimiter } from '../infrastructure/security/in-memory-attempt-limiter.js';
import { JoseAccessTokens } from '../infrastructure/security/jose-access-tokens.js';

const hasher: PasswordHasher = {
  hash: async (p) => `h:${p}`,
  verify: async (h, p) => h === `h:${p}`,
  dummyVerify: async () => undefined,
};
const meta = { userAgent: 'test', ip: '10.0.0.9' };
const REDIRECT_URI = 'http://localhost:5173/api/v1/auth/google/callback';

/** Google as a fake: the profile it returns echoes the nonce of the last authorization request. */
class FakeGoogle implements GoogleOAuthClient {
  lastNonce = '';
  lastRequest: { state: string; codeChallenge: string; redirectUri: string } | null = null;
  profile: Partial<GoogleProfile> = {};
  exchanged: { code: string; codeVerifier: string; redirectUri: string }[] = [];

  authorizationUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }) {
    this.lastNonce = input.nonce;
    this.lastRequest = input;
    return `https://accounts.google.test/auth?state=${input.state}`;
  }

  async exchange(input: { code: string; codeVerifier: string; redirectUri: string }) {
    this.exchanged.push(input);
    return {
      subject: 'google-sub-1',
      email: 'lan@gmail.com',
      emailVerified: true,
      name: 'Lan Nguyễn',
      nonce: this.lastNonce,
      ...this.profile,
    };
  }
}

async function setup(enabled = true) {
  const users = new InMemoryUserRepository();
  const identities = new InMemoryExternalIdentityRepository();
  const sessionRepo = new InMemorySessionRepository();
  const sessions = new SessionService(
    sessionRepo,
    await JoseAccessTokens.create({ NODE_ENV: 'test' }),
  );
  const box = SecretBox.insecureDevelopmentBox();
  const mfa = new MfaService(
    new InMemoryMfaRepository(),
    users,
    hasher,
    new InMemoryAttemptLimiter(20, 60_000),
    box,
    sessions,
  );
  const google = new FakeGoogle();
  const service = new GoogleSignInService(
    enabled ? google : null,
    { redirectUri: REDIRECT_URI },
    box,
    users,
    identities,
    sessions,
    mfa,
    new InMemoryAttemptLimiter(20, 60_000),
  );
  const login = new LoginHandler(
    users,
    hasher,
    new InMemoryAttemptLimiter(20, 60_000),
    sessions,
    mfa,
  );
  return { users, identities, sessionRepo, sessions, mfa, google, service, login };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Runs /start and a successful Google round trip; `over` tweaks the callback. */
async function signIn(
  s: Setup,
  redirect = '/app/inbox',
  over: { state?: string; code?: string } = {},
) {
  const { flow } = s.service.start(redirect);
  const state = s.google.lastRequest?.state ?? '';
  return s.service.callback({ code: 'auth-code', state, ...over }, flow, meta);
}

describe('Google sign-in', () => {
  it('starts with PKCE, state and nonce, and keeps the flow sealed', async () => {
    const s = await setup();
    const { url, flow } = s.service.start('/app/inbox');
    expect(url).toContain('accounts.google.test');
    expect(s.google.lastRequest?.redirectUri).toBe(REDIRECT_URI);
    expect(s.google.lastRequest?.codeChallenge).toMatch(/^[\w-]{43}$/);
    // The cookie value reveals neither the state nor the verifier.
    expect(flow).not.toContain(s.google.lastRequest?.state ?? '?');
  });

  it('creates a verified, password-less user on first sign-in and links the Google account', async () => {
    const s = await setup();
    const result = await signIn(s);
    expect(result.kind).toBe('session');
    if (result.kind !== 'session') return;
    expect(result.redirect).toBe('/app/inbox');
    expect(result.issued.user).toMatchObject({
      email: 'lan@gmail.com',
      name: 'Lan Nguyễn',
      emailVerified: true,
    });
    const user = await s.users.findByEmail('lan@gmail.com');
    expect(user?.hasPassword).toBe(false);
    expect(await s.identities.findUserId('google', 'google-sub-1')).toBe(user?.id);
    // PKCE: the verifier sent to Google hashes to the challenge of the request.
    const { createHash } = await import('node:crypto');
    const exchanged = s.google.exchanged[0];
    expect(
      createHash('sha256')
        .update(exchanged?.codeVerifier ?? '')
        .digest('base64url'),
    ).toBe(s.google.lastRequest?.codeChallenge);
  });

  it('signs a returning user in by the Google account even after the address changed', async () => {
    const s = await setup();
    const first = await signIn(s);
    s.google.profile = { email: 'lan.new@gmail.com' };
    const again = await signIn(s);
    expect(first.kind === 'session' && again.kind === 'session').toBe(true);
    if (first.kind !== 'session' || again.kind !== 'session') return;
    expect(again.issued.user.id).toBe(first.issued.user.id);
  });

  it('links to an existing account with the same email and keeps its password', async () => {
    const s = await setup();
    const existing = User.register({
      email: 'Lan@Gmail.com',
      name: 'Lan',
      passwordHash: 'h:secret-pass',
      emailVerifiedAt: new Date(),
    });
    await s.users.insert(existing);
    const result = await signIn(s);
    expect(result.kind === 'session' && result.issued.user.id).toBe(existing.id);
    expect((await s.users.findById(existing.id))?.hasPassword).toBe(true);
    await expect(
      s.login.execute({ email: 'lan@gmail.com', password: 'secret-pass', client: 'web' }, meta),
    ).resolves.toBeDefined();
  });

  it('drops the password of an unverified look-alike account and signs it out everywhere', async () => {
    const s = await setup();
    const squatter = User.register({
      email: 'lan@gmail.com',
      name: 'X',
      passwordHash: 'h:squatter-pass',
    });
    await s.users.insert(squatter);
    const old = await s.sessions.start(squatter, meta);
    await signIn(s);
    const user = await s.users.findById(squatter.id);
    expect(user?.emailVerified).toBe(true);
    expect(user?.hasPassword).toBe(false);
    await expect(s.sessions.consume(old.refreshToken)).rejects.toThrow();
    await expect(
      s.login.execute({ email: 'lan@gmail.com', password: 'squatter-pass', client: 'web' }, meta),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('refuses a wrong state, a missing or tampered flow, and an expired flow', async () => {
    const s = await setup();
    await expect(signIn(s, '/app', { state: 'forged' })).rejects.toMatchObject({
      reason: 'expired',
    });
    s.service.start('/app');
    const state = s.google.lastRequest?.state ?? '';
    await expect(s.service.callback({ code: 'c', state }, undefined, meta)).rejects.toMatchObject({
      reason: 'expired',
    });
    const { flow } = s.service.start('/app');
    await expect(
      s.service.callback({ code: 'c', state: s.google.lastRequest?.state }, `${flow}x`, meta),
    ).rejects.toMatchObject({ reason: 'expired' });
    const { flow: old } = s.service.start('/app', new Date(Date.now() - 11 * 60_000));
    await expect(
      s.service.callback({ code: 'c', state: s.google.lastRequest?.state }, old, meta),
    ).rejects.toMatchObject({ reason: 'expired' });
    expect(s.google.exchanged).toHaveLength(0);
  });

  it('reports a cancelled sign-in, a replayed ID token and an unverified Google address', async () => {
    const s = await setup();
    const { flow } = s.service.start('/app');
    await expect(s.service.callback({ error: 'access_denied' }, flow, meta)).rejects.toMatchObject({
      reason: 'cancelled',
    });
    s.google.profile = { nonce: 'from-another-sign-in' };
    await expect(signIn(s)).rejects.toMatchObject({ reason: 'failed' });
    s.google.profile = { emailVerified: false };
    await expect(signIn(s)).rejects.toMatchObject({ reason: 'unverified_email' });
    expect(await s.users.findByEmail('lan@gmail.com')).toBeNull();
  });

  it('asks a two-factor user for a code before any session', async () => {
    const s = await setup();
    const user = User.register({
      email: 'lan@gmail.com',
      name: 'Lan',
      passwordHash: 'h:secret-pass',
      emailVerifiedAt: new Date(),
    });
    await s.users.insert(user);
    const current = await s.sessions.start(user, meta);
    const sessionId = [...s.sessionRepo.rows.values()][0]?.id ?? '';
    const { secret } = await s.mfa.beginSetup(user.id, 'secret-pass');
    await s.mfa.enable(user.id, totpAt(secret, stepAt(Date.now())), sessionId);
    expect(current).toBeDefined();
    const sessionsBefore = s.sessionRepo.rows.size;

    const result = await signIn(s, '/app/settings');
    expect(result.kind).toBe('mfa');
    if (result.kind !== 'mfa') return;
    expect(result.redirect).toBe('/app/settings');
    expect(s.sessionRepo.rows.size).toBe(sessionsBefore);

    await expect(s.service.completeMfa(result.ticket, '000000', meta)).rejects.toBeInstanceOf(
      MfaCodeInvalidError,
    );
    const next = totpAt(secret, stepAt(Date.now()) + 1);
    const issued = await s.service.completeMfa(result.ticket, next, meta);
    expect(issued.user.id).toBe(user.id);
  });

  it('refuses an expired pending sign-in and a flow cookie used as one', async () => {
    const s = await setup();
    const old = new Date(Date.now() - 6 * 60_000);
    const user = User.register({
      email: 'lan@gmail.com',
      name: 'Lan',
      passwordHash: 'h:p4ssword',
      emailVerifiedAt: old,
    });
    await s.users.insert(user);
    await s.sessions.start(user, meta);
    const sessionId = [...s.sessionRepo.rows.values()][0]?.id ?? '';
    const { secret } = await s.mfa.beginSetup(user.id, 'p4ssword');
    await s.mfa.enable(user.id, totpAt(secret, stepAt(Date.now())), sessionId);
    const { flow } = s.service.start('/app', old);
    const result = await s.service.callback(
      { code: 'c', state: s.google.lastRequest?.state },
      flow,
      meta,
      old,
    );
    if (result.kind !== 'mfa') throw new Error('expected mfa');
    const code = totpAt(secret, stepAt(Date.now()) + 1);
    await expect(s.service.completeMfa(result.ticket, code, meta)).rejects.toMatchObject({
      reason: 'expired',
    });
    const { flow: fresh } = s.service.start('/app');
    await expect(s.service.completeMfa(fresh, code, meta)).rejects.toBeInstanceOf(
      GoogleSignInError,
    );
  });

  it('is unavailable without a Google client', async () => {
    const s = await setup(false);
    expect(s.service.enabled).toBe(false);
    expect(() => s.service.start('/app')).toThrow(GoogleSignInError);
  });

  it('a password login of a Google-only user fails like a wrong password', async () => {
    const s = await setup();
    await signIn(s);
    await expect(
      s.login.execute({ email: 'lan@gmail.com', password: 'anything-at-all', client: 'web' }, meta),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('keeps redirects inside the app', () => {
    expect(safeRedirect('/app/inbox?x=1')).toBe('/app/inbox?x=1');
    expect(safeRedirect('//evil.example')).toBe('/app/analytics');
    expect(safeRedirect('/\\evil.example')).toBe('/app/analytics');
    expect(safeRedirect('https://evil.example')).toBe('/app/analytics');
    expect(safeRedirect(undefined)).toBe('/app/analytics');
  });
});
