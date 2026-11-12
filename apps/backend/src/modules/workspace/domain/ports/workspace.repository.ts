import type { WorkspaceId } from '@agent-sales/shared';

import type { Workspace } from '../workspace.js';

/** Port implemented in infrastructure/persistence. Bound to one unit of work. */
export interface WorkspaceRepository {
  /** `lock`: hold the row until the unit of work ends (delete/restore vs the purge, ADR-032). */
  findById(id: WorkspaceId, opts?: { lock?: boolean }): Promise<Workspace | null>;
  save(workspace: Workspace): Promise<void>;
}
