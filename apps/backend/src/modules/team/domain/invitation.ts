import { createHash, randomBytes } from 'node:crypto';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface InvitationState {
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

/** A fresh link secret (shown once) and the hash that is stored. */
export function newInvitationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function invitationStatus(i: InvitationState, now = new Date()): InvitationStatus {
  if (i.acceptedAt) return 'accepted';
  if (i.revokedAt) return 'revoked';
  return i.expiresAt.getTime() <= now.getTime() ? 'expired' : 'pending';
}
