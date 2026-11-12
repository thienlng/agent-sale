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

/**
 * Fixed-window attempt limiter per key (IP + email), in process: a burst guard per API replica.
 * Limits that must hold across replicas (per account, per address) use `WindowCounter`.
 */
export interface AttemptLimiter {
  /** Records an attempt; returns seconds to wait when over the limit, else 0. */
  hit(key: string): Promise<number>;
  reset(key: string): Promise<void>;
}
export const ATTEMPT_LIMITER = Symbol('ATTEMPT_LIMITER');

/**
 * Shared fixed-window counter: every API process sees the same counts (Postgres in production,
 * migration 0076). Generic on purpose, so a Redis adapter can replace it without touching callers.
 */
export interface WindowCounter {
  /**
   * Counts one event for `key` in its window of `windowMs` (a new window starts when the last
   * one ended); returns the count so far, this one included, and the seconds left in the window.
   */
  hit(key: string, windowMs: number): Promise<{ count: number; retryAfterSeconds: number }>;
  reset(key: string): Promise<void>;
}
export const AUTH_COUNTER = Symbol('AUTH_COUNTER');

/** Signup-trial policy from config: extra disposable domains (`TRIAL_BLOCKED_EMAIL_DOMAINS`). */
export interface SignupTrialOptions {
  blockedDomains: readonly string[];
}
export const SIGNUP_TRIAL_OPTIONS = Symbol('SIGNUP_TRIAL_OPTIONS');
