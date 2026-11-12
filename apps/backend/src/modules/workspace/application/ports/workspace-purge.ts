import type { WorkspaceId } from '@agent-sales/shared';

/**
 * Cross-tenant purge of deleted businesses (ADR-032). The production adapter runs as the system
 * role (`withSystem`, ADR-004 amendment 2026-11-12) and deletes through `purgeWorkspaceRows` from
 * `@agent-sales/db`, which reads the tables to purge from the Postgres catalog.
 */
/** A business the purge should work on now, with how many runs of it failed before. */
export interface DuePurge {
  workspaceId: WorkspaceId;
  attempts: number;
}

export interface WorkspacePurgeStore {
  /**
   * Businesses to purge now, oldest first: `pending_deletion` whose restore window ended, and
   * `purging` ones (a claimed run that failed or died resumes); never one backing off after a
   * failure (`purge_next_at` in the future).
   */
  due(now: Date, limit: number): Promise<DuePurge[]>;
  /**
   * Claims the business in one statement: `pending_deletion` with its window ended (checked
   * against the database clock) becomes `purging`, which no restore accepts. A `purging` business
   * is already claimed (true: the run resumes). False when a restore won or it was purged.
   */
  claim(ws: WorkspaceId): Promise<boolean>;
  /** Hard-deletes every row of the business except the retained tables; rows per table. */
  purgeRows(ws: WorkspaceId): Promise<Record<string, number>>;
  /**
   * Turns the claimed (`purging`) `workspaces` row into a tombstone (`status = 'deleted'`,
   * `purged_at`, name and profile erased, back-off cleared), writes the audit event and
   * `workspace.workspace.purged.v1`. False when the business was not claimed (nothing written).
   */
  finish(ws: WorkspaceId, rows: number): Promise<boolean>;
  /**
   * A run failed: one more attempt counted, no new attempt before `nextAt`, `error` kept as the
   * failure's class or SQLSTATE (never a message, never data).
   */
  recordFailure(ws: WorkspaceId, failure: { error: string; nextAt: Date }): Promise<void>;
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
