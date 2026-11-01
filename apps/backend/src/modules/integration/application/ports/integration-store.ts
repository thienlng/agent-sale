import type { WorkspaceId } from '@agent-sales/shared';

export type IntegrationProvider = 'kiotviet';
export type ConnectionStatus = 'connected' | 'syncing' | 'error' | 'disconnected';
export type SyncJobKind = 'full_import' | 'reconcile' | 'webhook';
export type SyncLogLevel = 'info' | 'warning' | 'error';

export interface ConnectionSettings {
  saleBranchIds: number[];
  orderBranchId: number;
  pushOrders: boolean;
  syncCustomers: boolean;
  webhookIds?: number[];
  branches?: Array<{ id: number; name: string; address: string | null }>;
}

/** One PMS account linked to a workspace. Secrets are stored sealed (SecretBox), never plain. */
export interface ConnectionRecord {
  id: string;
  workspaceId: WorkspaceId;
  provider: IntegrationProvider;
  status: ConnectionStatus;
  retailer: string;
  clientId: string;
  clientSecretSealed: string;
  webhookToken: string;
  webhookSecretSealed: string;
  settings: ConnectionSettings;
  version: number;
  progress: { phase: string; done: number; total: number | null } | null;
  counts: { products?: number; customers?: number; ordersPushed?: number };
  lastError: { code: string; at: string } | null;
  lastFullSyncAt: Date | null;
  lastReconcileAt: Date | null;
  connectedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A leased job: every follow-up call must present `claimToken` (a re-claim rotates it). */
export interface JobRecord {
  id: string;
  workspaceId: WorkspaceId;
  connectionId: string;
  kind: SyncJobKind;
  payload: Record<string, unknown>;
  cursor: Record<string, unknown> | null;
  attempts: number;
  claimToken: string;
}

export interface SyncLogEntry {
  id: string;
  level: string;
  code: string;
  params: Record<string, string | number>;
  at: Date;
}

export interface ClaimedWebhookEvent {
  id: string;
  workspaceId: WorkspaceId;
  connectionId: string;
  body: string;
  signature: string | null;
}

/** Persistence of the integration module (its `integration_*` tables). */
export interface IntegrationStore {
  // Tenant-scoped (DB_TENANT, row-level security).
  liveConnection(ws: WorkspaceId, provider: IntegrationProvider): Promise<ConnectionRecord | null>;
  /** Throws `ConnectionExistsError` when the workspace already has a live connection. */
  insertConnection(ws: WorkspaceId, c: ConnectionRecord): Promise<void>;
  /**
   * Always bumps `updatedAt`. `version` counts owner edits only: it increments when the patch touches
   * `settings`, `retailer`, `clientId` or `clientSecretSealed`; runner writes (status, progress,
   * counts, lastError, sync timestamps) leave it as is. `id`, `workspaceId`, `provider`, `version`,
   * `createdAt` and `updatedAt` in the patch are ignored. Setting status `disconnected` stamps
   * `disconnected_at`. With `expectedVersion` (any patch), a stale version throws
   * `ConnectionVersionConflictError`; an unknown id throws `ConnectionNotFoundError`.
   */
  updateConnection(
    ws: WorkspaceId,
    id: string,
    patch: Partial<ConnectionRecord>,
    expectedVersion?: number,
  ): Promise<ConnectionRecord>;
  /** False when a full import or reconcile is already open for the connection. */
  enqueue(
    ws: WorkspaceId,
    job: {
      connectionId: string;
      kind: SyncJobKind;
      payload?: Record<string, unknown>;
      runAfter?: Date;
    },
  ): Promise<boolean>;
  /** Appends an entry and keeps only the newest 200 per connection. */
  log(
    ws: WorkspaceId,
    connectionId: string,
    e: { level: SyncLogLevel; code: string; params?: Record<string, string | number> },
  ): Promise<void>;
  recentLog(ws: WorkspaceId, connectionId: string, limit: number): Promise<SyncLogEntry[]>;
  cachedImage(ws: WorkspaceId, sourceUrl: string): Promise<string | null>;
  cacheImage(ws: WorkspaceId, sourceUrl: string, storedUrl: string): Promise<void>;

  // System role (DB_SYSTEM): work across tenants.
  /**
   * Leases ready jobs (`run_after <= now`, lease free or expired) with `FOR UPDATE SKIP LOCKED`,
   * rotating the claim token and counting the attempt. Open jobs of disconnected connections are
   * closed (`done_at`) instead of being claimed.
   */
  claimJobs(limit: number, leaseMs: number): Promise<JobRecord[]>;
  /*
   * Fenced writes: each one applies only while `claimToken` still owns the open job and returns
   * whether it did. `false` means the lease was lost (the job was re-claimed, closed or finished
   * elsewhere): the runner must abort the job at once, without further writes or side effects.
   */
  /** Stores the resume point and extends the lease to `now + leaseMs` (the runner's heartbeat). */
  saveCursor(
    jobId: string,
    claimToken: string,
    cursor: Record<string, unknown>,
    leaseMs: number,
  ): Promise<boolean>;
  completeJob(jobId: string, claimToken: string): Promise<boolean>;
  /** Releases the lease and makes the job ready again at `runAfter`. */
  retryJob(jobId: string, claimToken: string, runAfter: Date, error: string): Promise<boolean>;
  /** Dead-letters the job (`failed_at`). */
  failJob(jobId: string, claimToken: string, error: string): Promise<boolean>;
  /**
   * Marks the oldest unprocessed deliveries processed in the same statement (at-most-once: the
   * periodic reconcile covers a lost one). Deliveries of disconnected connections are consumed
   * but not returned.
   */
  claimWebhookEvents(limit: number): Promise<ClaimedWebhookEvent[]>;
  /** Connected or errored connections whose last reconcile is older than `olderThan` (or never). */
  connectionsDueForReconcile(
    olderThan: Date,
  ): Promise<Array<{ workspaceId: WorkspaceId; connectionId: string }>>;
  connectionForSystem(id: string): Promise<ConnectionRecord | null>;
}

export const INTEGRATION_STORE = Symbol('INTEGRATION_STORE');
