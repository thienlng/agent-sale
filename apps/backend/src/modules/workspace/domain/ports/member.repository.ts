import type { UserId, WorkspaceId } from '@agent-sales/shared';

/** Mirrors WORKSPACE_ROLES in contracts (migration 0014 mapped the older names). */
export type MemberRole = 'owner' | 'admin' | 'sales' | 'care' | 'analyst';

export interface Membership {
  id: string;
  workspaceId: WorkspaceId;
  userId: UserId;
  role: MemberRole;
  status: 'active' | 'removed';
}

/** Port implemented in infrastructure/persistence. Bound to one unit of work. */
export interface MemberRepository {
  add(membership: Membership): Promise<void>;
  find(workspaceId: WorkspaceId, userId: UserId): Promise<Membership | null>;
  /** Writes role and status (and the removal time when removed). */
  update(membership: Membership): Promise<void>;
  /**
   * Serialises seat decisions of one workspace until the transaction ends, so two
   * joins racing for the last seat cannot both succeed.
   */
  lockSeats(workspaceId: WorkspaceId): Promise<void>;
  countActive(workspaceId: WorkspaceId): Promise<number>;
}
