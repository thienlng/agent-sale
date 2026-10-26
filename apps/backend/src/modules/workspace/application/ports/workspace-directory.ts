import type { UserId, WorkspaceId } from '@agent-sales/shared';

import type { WorkspaceMember, WorkspaceMembership } from '../../api/workspace.facade.js';

/**
 * Cross-tenant, read-only lookups about memberships. Runs as the system role
 * because it answers "which workspaces may this user enter?" before any tenant
 * context exists. Never returns tenant business data.
 */
export interface WorkspaceDirectory {
  findMembership(workspaceId: WorkspaceId, userId: UserId): Promise<WorkspaceMembership | null>;
  listMemberships(userId: UserId): Promise<WorkspaceMembership[]>;
  listMembers(workspaceId: WorkspaceId, includeRemoved: boolean): Promise<WorkspaceMember[]>;
}

export const WORKSPACE_DIRECTORY = Symbol('WORKSPACE_DIRECTORY');
