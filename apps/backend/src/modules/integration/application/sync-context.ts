import type { WorkspaceId } from '@agent-sales/shared';

import type { ConnectionRecord, JobRecord } from './ports/integration-store.js';
import type { KvCredentials } from './ports/kiotviet-gateway.js';

/** Lease of a claimed job; `saveCursor` with it renews the lease (the runner's heartbeat). */
export const JOB_LEASE_MS = 5 * 60_000;
/** KiotViet's largest page. */
export const PAGE_SIZE = 100;

/** The job's lease was lost (re-claimed, closed or finished elsewhere): stop without writing. */
export class LeaseLostError extends Error {
  constructor() {
    super('integration job lease lost');
  }
}

/** The connection was disconnected (or vanished) while the job ran: complete it without writing. */
export class ConnectionGoneError extends Error {
  constructor() {
    super('integration connection disconnected');
  }
}

/** What a running job knows; `live()` re-reads the connection before each page and write batch. */
export interface SyncContext {
  job: JobRecord;
  ws: WorkspaceId;
  connection: ConnectionRecord;
  creds: KvCredentials;
  /** The current connection; throws `ConnectionGoneError` once it is disconnected. */
  live(): Promise<ConnectionRecord>;
  /** Saves the cursor; throws `LeaseLostError` when the lease is gone. */
  checkpoint(cursor: ImportCursor): Promise<void>;
}

/**
 * Resume point of a full import or reconcile (saved after every page). Seen KiotViet ids are kept
 * as sorted number arrays (compact jsonb) for the full-import sweep.
 */
export interface ImportCursor {
  mode: 'full' | 'incremental';
  phase: 'products' | 'stock' | 'finish';
  currentItem: number;
  /** The sale branches this run computes stock with (a change meanwhile queues a full reconcile). */
  saleBranchIds: number[];
  /** ISO start of the run: the next reconcile reads changes from here (minus the overlap). */
  startedAt: string;
  /** ISO `lastModifiedFrom` of an incremental run. */
  since: string | null;
  imagesFailed: number;
  /**
   * The sweep must not trust `seen`: a page came back short (malformed items dropped) or the
   * product total changed between pages (items may have shifted past the cursor).
   */
  incomplete: boolean;
  /** `total` of the first product page of a full run; a different total later marks it incomplete. */
  productTotal?: number | null;
  seenProducts: number[];
  seenVariants: number[];
}

export function isImportCursor(value: unknown): value is ImportCursor {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<ImportCursor>;
  return (
    (c.mode === 'full' || c.mode === 'incremental') &&
    (c.phase === 'products' || c.phase === 'stock' || c.phase === 'finish') &&
    typeof c.currentItem === 'number' &&
    Array.isArray(c.saleBranchIds) &&
    typeof c.startedAt === 'string' &&
    Array.isArray(c.seenProducts) &&
    Array.isArray(c.seenVariants)
  );
}

/** Adds ids to a sorted, duplicate-free number array. */
export function addSorted(into: number[], ids: Iterable<number>): number[] {
  return [...new Set([...into, ...ids])].sort((a, b) => a - b);
}
