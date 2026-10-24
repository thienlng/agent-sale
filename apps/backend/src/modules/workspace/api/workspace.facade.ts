import type { WorkspaceDto } from '@agent-sales/contracts';
import type { UserId, WorkspaceId } from '@agent-sales/shared';

export interface WorkspaceMembership {
  workspaceId: WorkspaceId;
  workspaceName: string;
  role: string;
}

/** A member of one workspace (removed ones only when asked for). */
export interface WorkspaceMember {
  userId: UserId;
  role: string;
  status: 'active' | 'removed';
  joinedAt: Date;
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
  /** Adds a member or reactivates a removed one with this role (the owner is left as is). */
  joinMember(workspaceId: WorkspaceId, userId: UserId, role: GivenRole): Promise<void>;
  /** NOT_FOUND for non-members; CONFLICT for the owner. */
  changeMemberRole(workspaceId: WorkspaceId, userId: UserId, role: GivenRole): Promise<void>;
  /** Their work stays (history, assignments); they lose access. CONFLICT for the owner. */
  removeMember(workspaceId: WorkspaceId, userId: UserId): Promise<void>;
}

export const WORKSPACE_FACADE = Symbol('WORKSPACE_FACADE');
