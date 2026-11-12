import type { UserId } from '@agent-sales/shared';

/** One refresh token. Rotation creates a new row in the same family. */
export interface SessionRecord {
  id: string;
  userId: UserId;
  familyId: string;
  tokenHash: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  /**
   * When the user last proved a factor on this session family (login, signup, Google sign-in or
   * step-up); copied on rotation. Null on sessions from before migration 0076.
   */
  authenticatedAt: Date | null;
  /** The session passed the second factor (login code, Google + code, or a TOTP step-up). */
  mfa: boolean;
}

export interface SessionRepository {
  create(session: SessionRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  /** The session an access token names (`sid`), for the guard's revocation check. */
  findById(id: string): Promise<SessionRecord | null>;
  /**
   * Marks the session rotated only if it is still active; returns false when it
   * was already rotated/revoked (concurrent refresh or token reuse).
   */
  markRotated(id: string, at: Date): Promise<boolean>;
  revoke(id: string, at: Date): Promise<void>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  /**
   * A successful step-up on the session's family: sets `authenticatedAt` on its active rows, and
   * `mfa` when the step-up used the second factor (never clears it).
   */
  markAuthenticated(sessionId: string, at: Date, mfa: boolean): Promise<void>;
  /** Revokes every active session of the user outside the family of `keepSessionId`. */
  revokeOtherFamilies(userId: UserId, keepSessionId: string, at: Date): Promise<void>;
}

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');
