import type { WorkspaceId } from '@agent-sales/shared';

import type { Workspace } from '../workspace.js';

/** Port implemented in infrastructure/persistence. Bound to one unit of work. */
export interface WorkspaceRepository {
  findById(id: WorkspaceId): Promise<Workspace | null>;
  save(workspace: Workspace): Promise<void>;
}
