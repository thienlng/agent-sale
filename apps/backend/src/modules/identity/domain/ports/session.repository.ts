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
}

export interface SessionRepository {
  create(session: SessionRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  /**
   * Marks the session rotated only if it is still active; returns false when it
   * was already rotated/revoked (concurrent refresh or token reuse).
   */
  markRotated(id: string, at: Date): Promise<boolean>;
  revoke(id: string, at: Date): Promise<void>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
}

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');
