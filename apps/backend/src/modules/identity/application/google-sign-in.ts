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
import { CODE_TTL_MINUTES, EmailCodeService } from './email-codes.js';
import { MfaService } from './mfa.service.js';
import {
  GOOGLE_CALLBACK_LIMITER,
  GOOGLE_OAUTH_CLIENT,
  GOOGLE_SIGN_IN_OPTIONS,
  type GoogleOAuthClient,
  type GoogleProfile,
  type GoogleSignInOptions,
} from './ports/google-oauth.js';
import { ATTEMPT_LIMITER, type AttemptLimiter } from './ports/security.js';
import { SecurityEventService } from './security-events.js';
import { type ClientMeta, type IssuedSession, SessionService } from './sessions.js';

/** How long the user may stay on Google's screen. */
export const GOOGLE_FLOW_TTL_MS = 10 * 60 * 1000;
/** How long a Google sign-in waits for the second factor. */
export const GOOGLE_MFA_TTL_MS = 5 * 60 * 1000;
/** How long a Google sign-up waits for the emailed code (the code's own lifetime). */
export const GOOGLE_VERIFY_TTL_MS = CODE_TTL_MINUTES * 60 * 1000;
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

/**
 * What a Google sign-in changes on the user, applied only once the sign-in is complete (after the
 * second factor when the user has one): link the Google account and, for a user whose address was
 * never proved, confirm it, drop the password and sign out every session.
 */
interface Pending {
  userId: UserId;
  link: { subject: string; email: string };
  claimUnverified: boolean;
  /** The Google account is not linked yet (recorded as `identity.linked` once applied). */
  newLink?: boolean;
}

/** Sealed in the cookie that waits for the second factor. */
interface MfaTicket {
  p: 'mfa';
  userId: UserId;
  /** Applied by `completeMfa` once the code checks out. */
  pending: Pending;
  redirect: string;
  exp: number;
}

/**
 * Sealed in the cookie that waits for the emailed code: a new account for an address Google is not
 * authoritative for is created only once the code proves the mailbox (no pre-hijack).
 */
interface VerifyTicket {
  p: 'verify';
  subject: string;
  email: string;
  name: string | null;
  redirect: string;
  exp: number;
}

export type GoogleCallbackResult =
  | { kind: 'session'; issued: IssuedSession; redirect: string }
  | { kind: 'mfa'; ticket: string; redirect: string }
  | { kind: 'verify'; ticket: string; redirect: string };

/**
 * The reason word shown on /login for a failed callback; null for an unexpected error (logged by
 * the caller, shown as `failed`).
 */
export function googleFailureReason(e: unknown): string | null {
  if (e instanceof GoogleSignInError) return e.reason;
  if (e instanceof TooManyAttemptsError) return 'too_many';
  return null;
}

/**
 * A same-app path only: one leading slash not followed by another slash, and no backslash, space or
 * control character anywhere (browsers drop tabs and newlines, so `/\t/evil` becomes `//evil`).
 */
export function safeRedirect(target: string | undefined | null): string {
  // eslint-disable-next-line no-control-regex
  return target && target.length <= 500 && /^\/(?!\/)[^\x00-\x20\x7f\\]*$/.test(target)
    ? target
    : DEFAULT_REDIRECT;
}

/**
 * Google is authoritative for an address only for Gmail and for a Google Workspace account of the
 * address's own domain (`hd` claim). Elsewhere `email_verified` only says the address was verified
 * once, when the Google account was made, so it must not take over an existing account (ADR-007).
 */
export function googleOwnsEmail(email: string, hostedDomain: string | null): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  if (domain === 'gmail.com') return true;
  return hostedDomain !== null && hostedDomain.toLowerCase() === domain;
}

/**
 * Sign in with Google (ADR-007): authorization code with PKCE, `state` against CSRF and `nonce`
 * against ID-token replay. The flow lives in a sealed, short-lived cookie, so the server keeps no
 * state between /start and /callback.
 *
 * The Google account (its `sub`) is linked to a user on first use: a new password-less user, or the
 * existing user with the same email when Google is authoritative for it (`googleOwnsEmail`);
 * otherwise the sign-in is refused with `account_exists` (sign in with the password). A new user
 * whose address Google is not authoritative for is created only after a code emailed to the
 * address checks out (`completeVerify`): `email_verified` alone does not prove the mailbox today. Linking to an
 * address nobody proved yet drops that account's password and signs it out everywhere, so a
 * pre-registered look-alike account cannot keep access. A user with two-factor still enters a code,
 * and nothing is linked or changed before it checks out.
 *
 * Callbacks that pass the state check are throttled per IP on their own limiter and a completed
 * sign-in resets it, so it counts failures; callbacks without a live flow never reach Google and
 * cost nothing.
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
    @Inject(GOOGLE_CALLBACK_LIMITER) private readonly callbackLimiter: AttemptLimiter,
    @Inject(EmailCodeService) private readonly codes: EmailCodeService,
    @Inject(SecurityEventService) private readonly events: SecurityEventService,
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
    if (input.error)
      throw new GoogleSignInError(input.error === 'access_denied' ? 'cancelled' : 'failed');
    const flow = this.#open<Flow>(sealedFlow, 'flow');
    if (!flow || flow.exp <= now.getTime() || !input.state || !sameText(input.state, flow.state)) {
      throw new GoogleSignInError('expired');
    }
    const key = `google:${meta.ip ?? 'unknown'}`;
    const wait = await this.callbackLimiter.hit(key);
    if (wait > 0) throw new TooManyAttemptsError(wait);
    if (!input.code) throw new GoogleSignInError('failed');
    const profile = await google.exchange({
      code: input.code,
      codeVerifier: flow.verifier,
      redirectUri: this.options.redirectUri,
    });
    if (!profile.nonce || !sameText(profile.nonce, flow.nonce))
      throw new GoogleSignInError('failed');
    if (!profile.emailVerified) throw new GoogleSignInError('unverified_email');

    const resolved = await this.#resolveUser(profile, now);
    await this.callbackLimiter.reset(key);
    if ('verify' in resolved) {
      const ticket: VerifyTicket = {
        ...resolved.verify,
        p: 'verify',
        redirect: flow.redirect,
        exp: now.getTime() + GOOGLE_VERIFY_TTL_MS,
      };
      return {
        kind: 'verify',
        ticket: this.box.seal(JSON.stringify(ticket)),
        redirect: flow.redirect,
      };
    }
    const { user, pending } = resolved;
    if (await this.mfa.isEnabled(user.id)) {
      const ticket: MfaTicket = {
        p: 'mfa',
        userId: user.id,
        pending,
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
      issued: await this.sessions.start(await this.#apply(pending, user, now, meta), meta),
      redirect: flow.redirect,
    };
  }

  /**
   * The emailed code that finishes a Google sign-up for an address Google is not authoritative for;
   * `GoogleSignInError('expired')` without a live ticket. Wrong codes count against the code itself
   * (`EmailCodeService`: a few attempts, then a new code is needed).
   */
  async completeVerify(
    sealedTicket: string | undefined,
    code: string,
    meta: ClientMeta,
    now = new Date(),
  ): Promise<IssuedSession> {
    const ticket = this.#open<VerifyTicket>(sealedTicket, 'verify');
    if (!ticket || ticket.exp <= now.getTime()) throw new GoogleSignInError('expired');
    await this.codes.consume(ticket.email, 'signup', code, now);
    const link = { subject: ticket.subject, email: ticket.email };
    // Linked or registered in the meantime (another tab): the normal rules apply.
    const linkedId = await this.identities.findUserId('google', ticket.subject);
    const linked = linkedId ? await this.users.findById(linkedId) : null;
    if (linked) return this.#startAfterCode(linked, link, false, meta, now);
    const created = await this.#register(ticket.email, ticket.name, now);
    if (!created) throw new GoogleSignInError('account_exists');
    return this.#startAfterCode(created, link, true, meta, now);
  }

  async #startAfterCode(
    user: User,
    link: Pending['link'],
    newLink: boolean,
    meta: ClientMeta,
    now: Date,
  ): Promise<IssuedSession> {
    // A linked user with two-factor never skips it: send them through the normal Google sign-in.
    if (await this.mfa.isEnabled(user.id)) throw new GoogleSignInError('expired');
    const pending: Pending = { userId: user.id, link, claimUnverified: false, newLink };
    return this.sessions.start(await this.#apply(pending, user, now, meta), meta);
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
    if (!user || ticket.pending?.userId !== user.id) throw new GoogleSignInError('expired');
    await this.limiter.reset(key);
    return this.sessions.start(await this.#apply(ticket.pending, user, now, meta), meta, {
      assurance: { authenticatedAt: now, mfa: true },
    });
  }

  /** Finds the user for a Google account without changing anything yet (see `#apply`). */
  async #resolveUser(
    profile: GoogleProfile,
    now: Date,
  ): Promise<
    { user: User; pending: Pending } | { verify: Pick<VerifyTicket, 'subject' | 'email' | 'name'> }
  > {
    const email = profile.email.trim().toLowerCase();
    const link = { subject: profile.subject, email };
    const linkedId = await this.identities.findUserId('google', profile.subject);
    const linked = linkedId ? await this.users.findById(linkedId) : null;
    if (linked)
      return { user: linked, pending: { userId: linked.id, link, claimUnverified: false } };
    const existing = await this.users.findByEmail(email);
    if (existing) return this.#claim(existing, profile, link);
    if (!googleOwnsEmail(email, profile.hostedDomain)) {
      const name = profile.name?.trim() || null;
      await this.#sendSignupCode(email, name);
      return { verify: { subject: profile.subject, email, name } };
    }
    const created = await this.#register(email, profile.name, now);
    if (created) {
      return {
        user: created,
        pending: { userId: created.id, link, claimUnverified: false, newLink: true },
      };
    }
    // The same address signed up a moment ago (another tab, or the email form).
    const raced = await this.users.findByEmail(email);
    if (!raced) throw new GoogleSignInError('failed');
    return this.#claim(raced, profile, link);
  }

  /** An existing account with the Google address: usable only when Google is authoritative for it. */
  #claim(
    user: User,
    profile: GoogleProfile,
    link: Pending['link'],
  ): { user: User; pending: Pending } {
    if (!googleOwnsEmail(link.email, profile.hostedDomain)) {
      throw new GoogleSignInError('account_exists');
    }
    return {
      user,
      pending: { userId: user.id, link, claimUnverified: !user.emailVerified, newLink: true },
    };
  }

  /** Within the resend cooldown the code already sent still works: no new email, same answer. */
  async #sendSignupCode(email: string, name: string | null): Promise<void> {
    try {
      await this.codes.send({ email, name }, 'signup');
    } catch (e) {
      if (!(e instanceof TooManyAttemptsError)) throw e;
    }
  }

  /** Makes the changes of a completed sign-in and returns the user as it now is. */
  async #apply(pending: Pending, user: User, now: Date, meta: ClientMeta): Promise<User> {
    if (pending.claimUnverified) {
      await this.users.confirmEmail(user.id, now, true);
      await this.sessions.revokeAll(user.id);
    }
    await this.identities.link(
      {
        provider: 'google',
        subject: pending.link.subject,
        userId: user.id,
        email: pending.link.email,
      },
      now,
    );
    if (pending.newLink)
      await this.events.record(user.id, 'identity.linked', { provider: 'google' }, meta.ip);
    return pending.claimUnverified ? ((await this.users.findById(user.id)) ?? user) : user;
  }

  /** The new user, or null when the address was taken in the meantime. */
  async #register(email: string, name: string | null, now: Date): Promise<User | null> {
    const created = User.registerFromProvider({
      email,
      name: (name?.trim() || email.split('@')[0] || email).slice(0, MAX_NAME),
      emailVerifiedAt: now,
    });
    try {
      await this.users.insert(created);
      return created;
    } catch (e) {
      if (e instanceof EmailTakenError) return null;
      throw e;
    }
  }

  #client(): GoogleOAuthClient {
    if (!this.google) throw new GoogleSignInError('unavailable');
    return this.google;
  }

  #open<T extends Flow | MfaTicket | VerifyTicket>(
    sealed: string | undefined,
    purpose: T['p'],
  ): T | null {
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
