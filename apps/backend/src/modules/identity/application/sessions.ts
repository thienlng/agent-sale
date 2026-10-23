import { createHash, randomBytes } from 'node:crypto';

import type { UserDto } from '@agent-sales/contracts';
import { newId, type UserId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { SessionInvalidError } from '../domain/identity.errors.js';
import { SESSION_REPOSITORY, type SessionRepository } from '../domain/ports/session.repository.js';
import type { User } from '../domain/user.js';
import { ACCESS_TOKENS, type AccessTokens } from './ports/security.js';

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
  };
}

/**
 * Refresh-token sessions with rotation + reuse detection (ADR-007):
 * every refresh retires the presented token and issues a new one in the same
 * family; presenting a retired token revokes the whole family.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(ACCESS_TOKENS) private readonly tokens: AccessTokens,
  ) {}

  async start(user: User, meta: ClientMeta, familyId: string = newId()): Promise<IssuedSession> {
    const refreshToken = randomBytes(32).toString('base64url');
    const now = new Date();
    const sessionId = newId();
    const refreshExpiresAt = new Date(now.getTime() + REFRESH_TTL_MS);
    await this.sessions.create({
      id: sessionId,
      userId: user.id,
      familyId,
      tokenHash: hashToken(refreshToken),
      userAgent: meta.userAgent,
      ip: meta.ip,
      createdAt: now,
      expiresAt: refreshExpiresAt,
      rotatedAt: null,
      revokedAt: null,
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

  /** Validates and retires `rawToken`; returns the owner and family for a new session. */
  async consume(rawToken: string): Promise<{ userId: UserId; familyId: string }> {
    const now = new Date();
    const session = await this.sessions.findByTokenHash(hashToken(rawToken));
    if (!session) throw new SessionInvalidError('unknown');
    if (session.revokedAt) throw new SessionInvalidError('revoked');
    if (session.rotatedAt) {
      // A retired token came back: assume theft, kill the whole family.
      await this.sessions.revokeFamily(session.familyId, now);
      throw new SessionInvalidError('reused');
    }
    if (session.expiresAt <= now) throw new SessionInvalidError('expired');
    if (!(await this.sessions.markRotated(session.id, now))) {
      await this.sessions.revokeFamily(session.familyId, now);
      throw new SessionInvalidError('reused');
    }
    return { userId: session.userId, familyId: session.familyId };
  }

  revoke(sessionId: string): Promise<void> {
    return this.sessions.revoke(sessionId, new Date());
  }
}
