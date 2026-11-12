import { createHash, randomBytes } from 'node:crypto';

import type { UserDto } from '@agent-sales/contracts';
import { newId, type UserId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { SessionInvalidError } from '../domain/identity.errors.js';
import { SESSION_REPOSITORY, type SessionRepository } from '../domain/ports/session.repository.js';
import type { User } from '../domain/user.js';
import { ACCESS_TOKENS, type AccessTokens } from './ports/security.js';
import {
  SESSION_POLICY,
  type SessionPolicy,
  type SessionState,
  SessionStateCache,
} from './session-state.js';

export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface ClientMeta {
  userAgent: string | null;
  ip: string | null;
}

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: UserDto;
}

/** How the user authenticated a session (kept across refresh rotations). */
export interface SessionAssurance {
  /** When a factor was last proved; a new sign-in is `now`. */
  authenticatedAt: Date | null;
  /** The second factor was checked. */
  mfa: boolean;
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function toUserDto(user: User): UserDto {
  const s = user.snapshot();
  return {
    id: s.id,
    email: s.email,
    name: s.name,
    phone: s.phone,
    emailVerified: s.emailVerifiedAt !== null,
    locale: s.locale,
    timezone: s.timezone,
    isPlatformAdmin: s.isPlatformAdmin,
  };
}

/**
 * Refresh-token sessions with rotation + reuse detection (ADR-007):
 * every refresh retires the presented token and issues a new one in the same
 * family; presenting a retired token revokes the whole family.
 *
 * Every authenticated request checks the session its access token names (`state`), so a logout,
 * a password reset or a two-factor change ends that session's access tokens too, not only its
 * refresh token. The check is cached per process for `SessionPolicy.cacheTtlMs`.
 */
@Injectable()
export class SessionService {
  readonly #cache: SessionStateCache;

  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(ACCESS_TOKENS) private readonly tokens: AccessTokens,
    @Inject(SESSION_POLICY) private readonly policy: SessionPolicy,
  ) {
    this.#cache = new SessionStateCache(policy.cacheTtlMs);
  }

  /**
   * Opens a session. A new sign-in passes `assurance: { authenticatedAt: now, mfa }` (default: now,
   * no second factor); a refresh passes the family and the assurance of the session it replaces.
   */
  async start(
    user: User,
    meta: ClientMeta,
    opts: { familyId?: string; assurance?: SessionAssurance } = {},
  ): Promise<IssuedSession> {
    const refreshToken = randomBytes(32).toString('base64url');
    const now = new Date();
    const sessionId = newId();
    const refreshExpiresAt = new Date(now.getTime() + REFRESH_TTL_MS);
    const assurance = opts.assurance ?? { authenticatedAt: now, mfa: false };
    await this.sessions.create({
      id: sessionId,
      userId: user.id,
      familyId: opts.familyId ?? newId(),
      tokenHash: hashToken(refreshToken),
      userAgent: meta.userAgent,
      ip: meta.ip,
      createdAt: now,
      expiresAt: refreshExpiresAt,
      rotatedAt: null,
      revokedAt: null,
      authenticatedAt: assurance.authenticatedAt,
      mfa: assurance.mfa,
    });
    const access = await this.tokens.issue({ userId: user.id, sessionId });
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken,
      refreshExpiresAt,
      user: toUserDto(user),
    };
  }

  /** Validates and retires `rawToken`; returns the owner, family and assurance for a new session. */
  async consume(
    rawToken: string,
  ): Promise<{ userId: UserId; familyId: string; assurance: SessionAssurance }> {
    const now = new Date();
    const session = await this.sessions.findByTokenHash(hashToken(rawToken));
    if (!session) throw new SessionInvalidError('unknown');
    if (session.revokedAt) throw new SessionInvalidError('revoked');
    if (session.rotatedAt) {
      // A retired token came back: assume theft, kill the whole family.
      await this.#revokeFamily(session.userId, session.familyId, now);
      throw new SessionInvalidError('reused');
    }
    if (session.expiresAt <= now) throw new SessionInvalidError('expired');
    if (!(await this.sessions.markRotated(session.id, now))) {
      await this.#revokeFamily(session.userId, session.familyId, now);
      throw new SessionInvalidError('reused');
    }
    return {
      userId: session.userId,
      familyId: session.familyId,
      assurance: { authenticatedAt: session.authenticatedAt, mfa: session.mfa },
    };
  }

  /**
   * The session an access token names, as the guard needs it; null when it does not exist.
   * `fresh` skips the cache (a step-up check must see a step-up made in another process).
   */
  async state(sessionId: string, fresh = false, now = Date.now()): Promise<SessionState | null> {
    if (!fresh) {
      const hit = this.#cache.get(sessionId, now);
      if (hit) return hit;
    }
    const row = await this.sessions.findById(sessionId);
    if (!row) return null;
    const state: SessionState = {
      userId: row.userId,
      revoked: row.revokedAt !== null,
      mfa: row.mfa,
      authenticatedAt: row.authenticatedAt,
    };
    this.#cache.set(sessionId, state, now);
    return state;
  }

  /** Whether the session proved a factor within the step-up window. */
  isRecent(state: Pick<SessionState, 'authenticatedAt'>, now = Date.now()): boolean {
    const at = state.authenticatedAt?.getTime();
    return at !== undefined && now - at <= this.policy.stepUpWindowMs;
  }

  /** How long a step-up counts, in seconds. */
  get stepUpWindowSeconds(): number {
    return Math.floor(this.policy.stepUpWindowMs / 1000);
  }

  /** A successful step-up on the session (and the rest of its family). */
  async markAuthenticated(userId: UserId, sessionId: string, mfa: boolean): Promise<void> {
    await this.sessions.markAuthenticated(sessionId, new Date(), mfa);
    this.#cache.forgetUser(userId);
  }

  /** Logout: ends the session's whole family, so no earlier rotation of it stays usable. */
  async logout(userId: UserId, sessionId: string): Promise<void> {
    const row = await this.sessions.findById(sessionId);
    if (row?.userId === userId) await this.#revokeFamily(userId, row.familyId, new Date());
    this.#cache.forgetUser(userId);
  }

  /** Signs the user out everywhere (password reset). */
  async revokeAll(userId: UserId): Promise<void> {
    await this.sessions.revokeOtherFamilies(userId, newId(), new Date());
    this.#cache.forgetUser(userId);
  }

  /** Signs the user out everywhere except the session making the request (its rotations stay valid). */
  async revokeOthers(userId: UserId, currentSessionId: string): Promise<void> {
    await this.sessions.revokeOtherFamilies(userId, currentSessionId, new Date());
    this.#cache.forgetUser(userId);
  }

  async #revokeFamily(userId: UserId, familyId: string, at: Date): Promise<void> {
    await this.sessions.revokeFamily(familyId, at);
    this.#cache.forgetUser(userId);
  }
}
