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
  /** Status `active` and not deleted (ADR-033 gate). */
  isActive(workspaceId: WorkspaceId): Promise<boolean>;
  /**
   * The business and the user's active role in it, deleted or not (delete and restore check the
   * owner themselves, because the auth guard no longer admits anyone into a deleted business).
   * Null when the user is not an active member.
   */
  deletionTarget(workspaceId: WorkspaceId, userId: UserId): Promise<DeletionTarget | null>;
  /** Businesses waiting for their purge in which the user is the owner, newest deletion first. */
  listDeletedOwnedBy(userId: UserId): Promise<DeletedBusiness[]>;
}

export interface DeletionTarget {
  role: string;
  status: string;
}

export interface DeletedBusiness {
  workspaceId: WorkspaceId;
  name: string;
  industry: string;
  icon: string;
  deletedAt: Date;
  purgeAfter: Date;
}

export const WORKSPACE_DIRECTORY = Symbol('WORKSPACE_DIRECTORY');
