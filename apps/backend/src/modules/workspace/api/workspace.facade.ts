import type { WorkspaceDto } from '@agent-sales/contracts';
import type { UserId, WorkspaceId } from '@agent-sales/shared';

export interface WorkspaceMembership {
  workspaceId: WorkspaceId;
  workspaceName: string;
  role: string;
}

/** An active member of one workspace. */
export interface WorkspaceMember {
  userId: UserId;
  role: string;
}

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
  /** Active members of a workspace (assignee pickers, assignment checks). */
  listMembers(workspaceId: WorkspaceId): Promise<WorkspaceMember[]>;
}

export const WORKSPACE_FACADE = Symbol('WORKSPACE_FACADE');
