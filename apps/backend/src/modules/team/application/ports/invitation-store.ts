import type { WorkspaceId } from '@agent-sales/shared';

export interface InvitationRecord {
  id: string;
  workspaceId: string;
  email: string;
  role: 'admin' | 'sales' | 'care' | 'analyst';
  tokenHash: string;
  invitedByUserId: string | null;
  invitedByName: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** The audit entry written in the same transaction as the invitation change. */
export interface InvitationAudit {
  actorUserId: string;
  actorName: string | null;
  action: string;
  data?: Record<string, unknown>;
}

/** Invitations of one workspace (tenant transaction) and lookups by link (system role). */
export interface InvitationStore {
  list(ws: WorkspaceId): Promise<InvitationRecord[]>;
  find(ws: WorkspaceId, id: string): Promise<InvitationRecord | null>;
  /** Invitations still waiting (not accepted, revoked or expired), except one for `exceptEmail`. */
  countPending(ws: WorkspaceId, exceptEmail: string): Promise<number>;
  /** Revokes the pending invitation of the same email and inserts this one, in one transaction. */
  replacePending(ws: WorkspaceId, i: InvitationRecord, audit: InvitationAudit): Promise<void>;
  revoke(ws: WorkspaceId, id: string, audit: InvitationAudit): Promise<InvitationRecord | null>;
  /** Any workspace: the invitee is not a member yet, so this runs as the system role. */
  findByTokenHash(hash: string): Promise<InvitationRecord | null>;
  /** Marks it accepted when still pending; false when someone got there first. */
  markAccepted(id: string, userId: string, at: Date): Promise<boolean>;
  /** Undoes a claim when joining failed (e.g. no free seat), so the link can be used again. */
  releaseAccepted(id: string, userId: string): Promise<void>;
}

export const INVITATION_STORE = Symbol('INVITATION_STORE');
