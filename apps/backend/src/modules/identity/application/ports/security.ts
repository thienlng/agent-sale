import type { UserId } from '@agent-sales/shared';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  /** Runs a verify against a fixed hash so unknown-email logins cost the same time. */
  dummyVerify(password: string): Promise<void>;
}
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

export interface AccessClaims {
  userId: UserId;
  sessionId: string;
  /** True on a delegated token (claim `dlg`, ADR-024): it cannot be delegated again. */
  delegated?: boolean;
}

/** Short-lived signed access tokens (JWT EdDSA, 15 min — ADR-007). */
export interface AccessTokens {
  /** `ttlSeconds` defaults to the 15-min access TTL; delegated tokens pass a shorter one. */
  issue(claims: AccessClaims, ttlSeconds?: number): Promise<{ token: string; expiresIn: number }>;
  /** Returns null for any invalid/expired token (never throws to callers). */
  verify(token: string): Promise<AccessClaims | null>;
}
export const ACCESS_TOKENS = Symbol('ACCESS_TOKENS');

/** Fixed-window attempt limiter per key (IP + email). Redis-backed in production later. */
export interface AttemptLimiter {
  /** Records an attempt; returns seconds to wait when over the limit, else 0. */
  hit(key: string): Promise<number>;
  reset(key: string): Promise<void>;
}
export const ATTEMPT_LIMITER = Symbol('ATTEMPT_LIMITER');
