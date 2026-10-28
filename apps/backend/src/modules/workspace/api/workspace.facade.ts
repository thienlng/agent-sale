import type { WorkspaceDto } from '@agent-sales/contracts';
import type { UserId, WorkspaceId } from '@agent-sales/shared';

export interface WorkspaceMembership {
  workspaceId: WorkspaceId;
  workspaceName: string;
  role: string;
  /** Short hash of the logo image, null without one; lets clients cache the picture. */
  logoVersion?: string | null;
}

/** A member of one workspace (removed ones only when asked for). */
export interface WorkspaceMember {
  userId: UserId;
  role: string;
  status: 'active' | 'removed';
  joinedAt: Date;
}

/** Who is acting, for the audit trail. */
export interface MemberActor {
  userId: string;
  name: string | null;
}

/** Roles that can be given; there is exactly one owner. */
export type GivenRole = 'admin' | 'sales' | 'care' | 'analyst';

/**
 * PUBLIC CONTRACT of the workspace module. Other modules inject
 * WORKSPACE_FACADE and call these methods; they never touch workspace tables.
 */
export interface WorkspaceFacade {
  getById(workspaceId: WorkspaceId): Promise<WorkspaceDto>;
  createWorkspace(input: {
    name: string;
    industry: string;
    ownerUserId: UserId;
    accountId?: string | undefined;
    timezone?: string | undefined;
  }): Promise<WorkspaceDto>;
  /** Active membership of `userId` in `workspaceId`, or null (used by the auth guard). */
  findMembership(workspaceId: WorkspaceId, userId: UserId): Promise<WorkspaceMembership | null>;
  /** All active memberships of a user across workspaces (bootstrap, workspace switcher). */
  listMemberships(userId: UserId): Promise<WorkspaceMembership[]>;
  /** Active members of a workspace (assignee pickers, assignment checks); removed ones too on request. */
  listMembers(
    workspaceId: WorkspaceId,
    opts?: { includeRemoved?: boolean },
  ): Promise<WorkspaceMember[]>;
  /**
   * Adds a member or reactivates a removed one with this role (the owner is left as
   * is). `seatLimit` (`null` = unlimited) is enforced atomically: QUOTA_EXCEEDED when
   * no seat is free for a newly active member.
   */
  joinMember(
    workspaceId: WorkspaceId,
    userId: UserId,
    role: GivenRole,
    opts: { seatLimit: number | null; actor: MemberActor },
  ): Promise<void>;
  /** NOT_FOUND for non-members; CONFLICT for the owner. */
  changeMemberRole(
    workspaceId: WorkspaceId,
    userId: UserId,
    role: GivenRole,
    actor: MemberActor,
  ): Promise<void>;
  /** Their work stays (history, assignments); they lose access. CONFLICT for the owner. */
  removeMember(workspaceId: WorkspaceId, userId: UserId, actor: MemberActor): Promise<void>;
}

export const WORKSPACE_FACADE = Symbol('WORKSPACE_FACADE');
