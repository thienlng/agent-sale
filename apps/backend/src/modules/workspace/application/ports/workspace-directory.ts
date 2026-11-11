import type { UserId, WorkspaceId } from '@agent-sales/shared';

import type {
  AccountBusiness,
  WorkspaceMember,
  WorkspaceMembership,
} from '../../api/workspace.facade.js';

/**
 * Cross-tenant, read-only lookups about memberships. Runs as the system role
 * because it answers "which workspaces may this user enter?" before any tenant
 * context exists. Never returns tenant business data.
 */
export interface WorkspaceDirectory {
  findMembership(workspaceId: WorkspaceId, userId: UserId): Promise<WorkspaceMembership | null>;
  listMemberships(userId: UserId): Promise<WorkspaceMembership[]>;
  listMembers(workspaceId: WorkspaceId, includeRemoved: boolean): Promise<WorkspaceMember[]>;
  /** Active, not deleted businesses by id, after `afterId` (worker scans). */
  listActiveIds(afterId: WorkspaceId | null, limit: number): Promise<WorkspaceId[]>;
  /** Businesses of these accounts with their active member count (platform admin). */
  listByAccounts(accountIds: readonly string[]): Promise<AccountBusiness[]>;
}

export const WORKSPACE_DIRECTORY = Symbol('WORKSPACE_DIRECTORY');
