import type { WorkspaceId } from '@agent-sales/shared';

import type { FactDraft, OutboxRow } from '../fact.js';

/** One batch of work, held under an exclusive lease so two projectors never interleave. */
export interface ProjectionLease {
  checkpoint(): Promise<number>;
  /** Committed events after `afterId` that no open transaction can still precede, oldest first. */
  readBatch(afterId: number, limit: number): Promise<OutboxRow[]>;
  commit(lastId: number): Promise<void>;
  deadLetter(row: OutboxRow, error: string): Promise<void>;
}

export interface ProjectionStore {
  /** Runs `fn` with the lease, or returns null when another projector holds it. */
  withLease<T>(fn: (lease: ProjectionLease) => Promise<T | null>): Promise<T | null>;
  /** Where the projection is and how far behind (a gap is reported, never hidden). */
  health(): Promise<{ watermarkId: number; watermarkAt: Date | null; lagSeconds: number }>;
  /** Events of one workspace in order (rebuild). */
  readWorkspace(ws: WorkspaceId, afterId: number, limit: number): Promise<OutboxRow[]>;
  /** Operator action: forget a workspace's facts so they can be replayed. */
  deleteFacts(ws: WorkspaceId): Promise<void>;
}
export const PROJECTION_STORE = Symbol('PROJECTION_STORE');

export interface FactStore {
  /** Idempotent: a fact already recorded for (workspace, event, kind) is skipped. Returns how many were new. */
  append(ws: WorkspaceId, facts: readonly FactDraft[]): Promise<number>;
}
export const FACT_STORE = Symbol('FACT_STORE');
