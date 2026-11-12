import type { WorkspaceId } from '@agent-sales/shared';

import type { Workspace } from '../workspace.js';

/** Port implemented in infrastructure/persistence. Bound to one unit of work. */
export interface WorkspaceRepository {
  /** `lock`: hold the row until the unit of work ends (delete/restore vs the purge, ADR-032). */
  findById(id: WorkspaceId, opts?: { lock?: boolean }): Promise<Workspace | null>;
  save(workspace: Workspace): Promise<void>;
  /**
   * Restores a deleted business in one conditional write: only while the stored row is
   * `pending_deletion` and its restore window is open. The Drizzle adapter checks
   * `purge_after > now()` with the database clock (the purge's claim checks `purge_after <= now()`
   * in the same way, so exactly one of them matches) and ignores `now`, which only the in-memory
   * adapter uses. False: the window closed or the purge claimed the business; nothing written.
   */
  restoreWithinWindow(id: WorkspaceId, now: Date): Promise<boolean>;
}
