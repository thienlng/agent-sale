import type { WorkspaceDto } from '@agent-sales/contracts';
import type { UserId, WorkspaceId } from '@agent-sales/shared';

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
}

export const WORKSPACE_FACADE = Symbol('WORKSPACE_FACADE');
