import { API_KEY_PREFIX } from '@agent-sales/contracts';
import { Inject, Injectable } from '@nestjs/common';

import type { IdentityDelegationFacade } from '../api/identity.facade.js';
import { ACCESS_TOKENS, type AccessTokens } from './ports/security.js';

/** A delegated token never lives longer than this, whatever the caller asks for. */
export const MAX_DELEGATED_TTL_SECONDS = 10 * 60;

/**
 * Short-lived delegated access tokens (ADR-024): the same user and session as a valid access
 * token, so the guard derives the same memberships and permissions, but with its own short
 * expiry. Only an access token can be delegated: an API key, an expired or invalid token, or a
 * token that is itself delegated gives null (no chains).
 */
@Injectable()
export class DelegatedAccessService implements IdentityDelegationFacade {
  constructor(@Inject(ACCESS_TOKENS) private readonly tokens: AccessTokens) {}

  async delegate(authorization: string, ttlSeconds: number): Promise<string | null> {
    if (!authorization.startsWith('Bearer ')) return null;
    const raw = authorization.slice(7);
    if (raw.startsWith(API_KEY_PREFIX)) return null;
    const claims = await this.tokens.verify(raw);
    if (!claims || claims.delegated) return null;
    const ttl = Math.min(Math.max(Math.ceil(ttlSeconds), 1), MAX_DELEGATED_TTL_SECONDS);
    const { token } = await this.tokens.issue(
      { userId: claims.userId, sessionId: claims.sessionId, delegated: true },
      ttl,
    );
    return token;
  }
}
