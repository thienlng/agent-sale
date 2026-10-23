import type { WorkspaceId } from '@agent-sales/shared';

import type { Workspace } from '../workspace.js';

/** Port implemented in infrastructure/persistence. Injected by token. */
export interface WorkspaceRepository {
  findById(id: WorkspaceId): Promise<Workspace | null>;
  save(workspace: Workspace): Promise<void>;
}

export const WORKSPACE_REPOSITORY = Symbol('WORKSPACE_REPOSITORY');
