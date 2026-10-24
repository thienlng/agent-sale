import type { WorkspaceId } from '@agent-sales/shared';

import type { FactDraft, OutboxRow } from '../fact.js';

/**
 * One pass of work, held under an exclusive lease so two projectors never interleave. The lease
 * fixes a window at the moment it is taken: the committed events of every transaction that finished
 * since the last pass (a transaction still running is not in it, and is picked up by a later pass,
 * whatever order the outbox ids were handed out in).
 */
export interface ProjectionLease {
  /** Events of the window with an id after `afterId`, oldest first. */
  readBatch(afterId: number, limit: number): Promise<OutboxRow[]>;
  /** Moves the position to the end of the window: everything in it has been dealt with. */
  commit(): Promise<void>;
  deadLetter(row: OutboxRow, error: string): Promise<void>;
  /** Events of one workspace that had finished when the lease was taken (rebuild). */
  readWorkspace(ws: WorkspaceId, afterId: number, limit: number): Promise<OutboxRow[]>;
  /** Forget a workspace's facts and write these instead, in the lease's own transaction (all or nothing). */
  replaceFacts(ws: WorkspaceId, facts: readonly FactDraft[]): Promise<void>;
}

export interface ProjectionHealth {
  /** Highest fact id: queries freeze their data at it (`id <= watermark`). */
  watermarkId: number;
  /** When the projector last moved. */
  watermarkAt: Date | null;
  /** How long the oldest committed event not yet projected has been waiting (0 = up to date). */
  lagSeconds: number;
}

export interface ProjectionStore {
  /** Runs `fn` with the lease, or returns null when another projector holds it. */
  withLease<T>(fn: (lease: ProjectionLease) => Promise<T | null>): Promise<T | null>;
  /** Where the projection is and how far behind (a gap is reported, never hidden). */
  health(): Promise<ProjectionHealth>;
}
export const PROJECTION_STORE = Symbol('PROJECTION_STORE');

export interface FactStore {
  /** Idempotent: a fact already recorded for (workspace, event, kind) is skipped. Returns how many were new. */
  append(ws: WorkspaceId, facts: readonly FactDraft[]): Promise<number>;
}
export const FACT_STORE = Symbol('FACT_STORE');
