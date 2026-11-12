import type { UserId } from '@agent-sales/shared';

/** What the guard needs to know about the session an access token names. */
export interface SessionState {
  userId: UserId;
  revoked: boolean;
  /** The session passed the second factor. */
  mfa: boolean;
  /** When the user last proved a factor on this session; null when never recorded. */
  authenticatedAt: Date | null;
  /** The last explicit step-up (`POST /auth/reauth`); a sign-in never sets it. */
  steppedUpAt: Date | null;
}

/** Session timing knobs (`AUTH_SESSION_CACHE_TTL_MS`, `AUTH_STEP_UP_WINDOW_MINUTES`). */
export interface SessionPolicy {
  cacheTtlMs: number;
  stepUpWindowMs: number;
}
export const SESSION_POLICY = Symbol('SESSION_POLICY');
export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  cacheTtlMs: 15_000,
  stepUpWindowMs: 10 * 60_000,
};

const MAX_ENTRIES = 10_000;

/**
 * Per-process cache of session states, so the guard reads a session at most once per TTL per
 * process (docs/16: no database round trip on every request). Changes made by this process drop
 * the user's entries at once; other processes see them within the TTL. Insertion order is the
 * eviction order (oldest out first when full).
 */
export class SessionStateCache {
  readonly #entries = new Map<string, { state: SessionState; until: number }>();

  constructor(private readonly ttlMs: number) {}

  get(sessionId: string, now: number): SessionState | undefined {
    const hit = this.#entries.get(sessionId);
    if (!hit) return undefined;
    if (hit.until <= now) {
      this.#entries.delete(sessionId);
      return undefined;
    }
    return hit.state;
  }

  set(sessionId: string, state: SessionState, now: number): void {
    if (this.ttlMs <= 0) return;
    this.#entries.delete(sessionId);
    if (this.#entries.size >= MAX_ENTRIES) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
    this.#entries.set(sessionId, { state, until: now + this.ttlMs });
  }

  forgetUser(userId: UserId): void {
    for (const [id, e] of this.#entries) if (e.state.userId === userId) this.#entries.delete(id);
  }
}
