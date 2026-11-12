import type { WorkspaceId } from '@agent-sales/shared';

/**
 * Cross-tenant purge of deleted businesses (ADR-032). The production adapter runs as the system
 * role (`withSystem`, ADR-004 amendment 2026-11-12) and deletes through `purgeWorkspaceRows` from
 * `@agent-sales/db`, which reads the tables to purge from the Postgres catalog.
 */
export interface WorkspacePurgeStore {
  /** Businesses whose restore window ended and that are not purged yet, oldest window first. */
  due(now: Date, limit: number): Promise<WorkspaceId[]>;
  /**
   * Re-checks under the row lock that the business is still waiting for its purge and its window
   * ended (a restore that won the lock first makes this false).
   */
  stillDue(ws: WorkspaceId): Promise<boolean>;
  /** Hard-deletes every row of the business except the retained tables; rows per table. */
  purgeRows(ws: WorkspaceId): Promise<Record<string, number>>;
  /**
   * Turns the `workspaces` row into a tombstone (`status = 'deleted'`, `purged_at`, name and
   * profile erased), writes the audit event and `workspace.workspace.purged.v1`. False when the
   * business was not due any more (nothing written).
   */
  finish(ws: WorkspaceId, rows: number): Promise<boolean>;
}

/** Deletes a business's files in object storage (ADR-032 §storage). */
export interface BusinessObjectEraser {
  /** True when object storage is configured; when it is not there is nothing to delete. */
  available(): boolean;
  /** Deletes every object under the business's prefixes; returns how many were deleted. */
  erase(ws: WorkspaceId): Promise<number>;
}

export const WORKSPACE_PURGE_STORE = Symbol('WORKSPACE_PURGE_STORE');
export const BUSINESS_OBJECT_ERASER = Symbol('BUSINESS_OBJECT_ERASER');
