import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { UserId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { SECRET_BOX, type SecretBox } from '../../../common/security/secret-box.js';
import {
  EmailTakenError,
  GoogleSignInError,
  MfaCodeInvalidError,
  TooManyAttemptsError,
} from '../domain/identity.errors.js';
import {
  EXTERNAL_IDENTITY_REPOSITORY,
  type ExternalIdentityRepository,
} from '../domain/ports/external-identity.repository.js';
import { USER_REPOSITORY, type UserRepository } from '../domain/ports/user.repository.js';
import { User } from '../domain/user.js';
import { MfaService } from './mfa.service.js';
import {
  GOOGLE_OAUTH_CLIENT,
  GOOGLE_SIGN_IN_OPTIONS,
  type GoogleOAuthClient,
  type GoogleProfile,
  type GoogleSignInOptions,
} from './ports/google-oauth.js';
import { ATTEMPT_LIMITER, type AttemptLimiter } from './ports/security.js';
import { type ClientMeta, type IssuedSession, SessionService } from './sessions.js';

/** How long the user may stay on Google's screen. */
export const GOOGLE_FLOW_TTL_MS = 10 * 60 * 1000;
/** How long a Google sign-in waits for the second factor. */
export const GOOGLE_MFA_TTL_MS = 5 * 60 * 1000;
const DEFAULT_REDIRECT = '/app/analytics';
const MAX_NAME = 120;

/** Sealed in the flow cookie between /start and /callback. */
interface Flow {
  p: 'flow';
  state: string;
  verifier: string;
  nonce: string;
  redirect: string;
  exp: number;
}

/** Sealed in the cookie that waits for the second factor. */
interface MfaTicket {
  p: 'mfa';
  userId: UserId;
  redirect: string;
  exp: number;
}

export type GoogleCallbackResult =
  | { kind: 'session'; issued: IssuedSession; redirect: string }
  | { kind: 'mfa'; ticket: string; redirect: string };

/**
 * The reason word shown on /login for a failed callback; null for an unexpected error (logged by
 * the caller, shown as `failed`).
 */
export function googleFailureReason(e: unknown): string | null {
  if (e instanceof GoogleSignInError) return e.reason;
  if (e instanceof TooManyAttemptsError) return 'too_many';
  return null;
}

/** A same-app path only: one leading slash, not followed by another slash or a backslash. */
export function safeRedirect(target: string | undefined | null): string {
  return target && /^\/(?![/\\])/.test(target) && target.length <= 500 ? target : DEFAULT_REDIRECT;
}

/**
 * Sign in with Google (ADR-007): authorization code with PKCE, `state` against CSRF and `nonce`
 * against ID-token replay. The flow lives in a sealed, short-lived cookie, so the server keeps no
 * state between /start and /callback.
 *
 * The Google account (its `sub`) is linked to a user on first use: the user with the same email,
 * or a new password-less user. Linking to an address nobody proved yet drops that account's
 * password and signs it out everywhere, so a pre-registered look-alike account cannot keep access.
 * A user with two-factor still enters a code.
 */
@Injectable()
export class GoogleSignInService {
  constructor(
    @Inject(GOOGLE_OAUTH_CLIENT) private readonly google: GoogleOAuthClient | null,
    @Inject(GOOGLE_SIGN_IN_OPTIONS) private readonly options: GoogleSignInOptions,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(EXTERNAL_IDENTITY_REPOSITORY) private readonly identities: ExternalIdentityRepository,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(ATTEMPT_LIMITER) private readonly limiter: AttemptLimiter,
  ) {}

  get enabled(): boolean {
    return this.google !== null;
  }

  /** The Google URL to send the browser to, and the sealed flow for the cookie. */
  start(redirect: string | undefined, now = new Date()): { url: string; flow: string } {
    const google = this.#client();
    const flow: Flow = {
      p: 'flow',
      state: random(),
      verifier: random(),
      nonce: random(),
      redirect: safeRedirect(redirect),
      exp: now.getTime() + GOOGLE_FLOW_TTL_MS,
    };
    const url = google.authorizationUrl({
      state: flow.state,
      nonce: flow.nonce,
      codeChallenge: createHash('sha256').update(flow.verifier).digest('base64url'),
      redirectUri: this.options.redirectUri,
    });
    return { url, flow: this.box.seal(JSON.stringify(flow)) };
  }

  /** The redirect target kept in a flow cookie, so failures still land the user where they were going. */
  redirectOf(sealedFlow: string | undefined): string {
    return this.#open<Flow>(sealedFlow, 'flow')?.redirect ?? DEFAULT_REDIRECT;
  }

  async callback(
    input: { code?: string | undefined; state?: string | undefined; error?: string | undefined },
    sealedFlow: string | undefined,
    meta: ClientMeta,
    now = new Date(),
  ): Promise<GoogleCallbackResult> {
    const google = this.#client();
    const wait = await this.limiter.hit(`google:${meta.ip ?? 'unknown'}`);
    if (wait > 0) throw new TooManyAttemptsError(wait);
    if (input.error)
      throw new GoogleSignInError(input.error === 'access_denied' ? 'cancelled' : 'failed');
    const flow = this.#open<Flow>(sealedFlow, 'flow');
    if (!flow || flow.exp <= now.getTime() || !input.state || !sameText(input.state, flow.state)) {
      throw new GoogleSignInError('expired');
    }
    if (!input.code) throw new GoogleSignInError('failed');
    const profile = await google.exchange({
      code: input.code,
      codeVerifier: flow.verifier,
      redirectUri: this.options.redirectUri,
    });
    if (!profile.nonce || !sameText(profile.nonce, flow.nonce))
      throw new GoogleSignInError('failed');
    if (!profile.emailVerified) throw new GoogleSignInError('unverified_email');

    const user = await this.#resolveUser(profile, now);
    if (await this.mfa.isEnabled(user.id)) {
      const ticket: MfaTicket = {
        p: 'mfa',
        userId: user.id,
        redirect: flow.redirect,
        exp: now.getTime() + GOOGLE_MFA_TTL_MS,
      };
      return {
        kind: 'mfa',
        ticket: this.box.seal(JSON.stringify(ticket)),
        redirect: flow.redirect,
      };
    }
    return {
      kind: 'session',
      issued: await this.sessions.start(user, meta),
      redirect: flow.redirect,
    };
  }

  /** The second factor after a Google sign-in; `GoogleSignInError('expired')` without a live ticket. */
  async completeMfa(
    sealedTicket: string | undefined,
    code: string,
    meta: ClientMeta,
    now = new Date(),
  ): Promise<IssuedSession> {
    const ticket = this.#open<MfaTicket>(sealedTicket, 'mfa');
    if (!ticket || ticket.exp <= now.getTime()) throw new GoogleSignInError('expired');
    const key = `google-mfa:${ticket.userId}`;
    const wait = await this.limiter.hit(key);
    if (wait > 0) throw new TooManyAttemptsError(wait);
    if (!(await this.mfa.verifyLogin(ticket.userId, code))) throw new MfaCodeInvalidError();
    const user = await this.users.findById(ticket.userId);
    if (!user) throw new GoogleSignInError('expired');
    await this.limiter.reset(key);
    return this.sessions.start(user, meta);
  }

  async #resolveUser(profile: GoogleProfile, now: Date): Promise<User> {
    const email = profile.email.trim().toLowerCase();
    const linkedId = await this.identities.findUserId('google', profile.subject);
    let user = linkedId ? await this.users.findById(linkedId) : null;
    if (!user) user = await this.users.findByEmail(email);
    if (user && !user.emailVerified) {
      await this.users.confirmEmail(user.id, now, true);
      await this.sessions.revokeAll(user.id);
      user = (await this.users.findById(user.id)) ?? user;
    }
    if (!user) user = await this.#register(email, profile.name, now);
    await this.identities.link(
      { provider: 'google', subject: profile.subject, userId: user.id, email },
      now,
    );
    return user;
  }

  async #register(email: string, name: string | null, now: Date): Promise<User> {
    const created = User.registerFromProvider({
      email,
      name: (name?.trim() || email.split('@')[0] || email).slice(0, MAX_NAME),
      emailVerifiedAt: now,
    });
    try {
      await this.users.insert(created);
      return created;
    } catch (e) {
      // The same address signed up a moment ago (another tab, or the email form): use that user.
      if (!(e instanceof EmailTakenError)) throw e;
      const existing = await this.users.findByEmail(email);
      if (!existing) throw e;
      return existing;
    }
  }

  #client(): GoogleOAuthClient {
    if (!this.google) throw new GoogleSignInError('unavailable');
    return this.google;
  }

  #open<T extends Flow | MfaTicket>(sealed: string | undefined, purpose: T['p']): T | null {
    if (!sealed) return null;
    try {
      const value = JSON.parse(this.box.open(sealed)) as T;
      return value.p === purpose ? value : null;
    } catch {
      return null;
    }
  }
}

function random(): string {
  return randomBytes(32).toString('base64url');
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
