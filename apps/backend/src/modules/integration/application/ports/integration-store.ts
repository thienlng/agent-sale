import type { WorkspaceId } from '@agent-sales/shared';

export type IntegrationProvider = 'kiotviet';
export type ConnectionStatus = 'connected' | 'syncing' | 'error' | 'disconnected';
/**
 * `customer_import`: the customer import (empty payload) or, with `payload.contactId`, the push of
 * one Rapiz customer to KiotViet (PR 3).
 */
export type SyncJobKind =
  'full_import' | 'reconcile' | 'webhook' | 'push_order' | 'customer_import';
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
  /**
   * Failed attempts recorded so far (`retryJob`); 0 on the first run. A re-claim after a lapsed
   * lease (worker restart, slow page) does not count, so a long import is never dead-lettered for
   * taking long.
   */
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
  /**
   * False when the job is already queued: a full import or reconcile open for the connection, a
   * `push_order` job open for the same `payload.orderId` (unique index, so two workers never both
   * queue one), or a `customer_import` open for the connection with the same `payload.contactId`
   * (or none: one customer import at a time; serialized by an advisory lock).
   */
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
  /** The newest `push_order` job of an order (open or not), or null. */
  latestPushJob(
    ws: WorkspaceId,
    orderId: string,
  ): Promise<{
    open: boolean;
    payload: Record<string, unknown>;
    cursor: Record<string, unknown> | null;
  } | null>;
  cachedImage(ws: WorkspaceId, sourceUrl: string): Promise<string | null>;
  cacheImage(ws: WorkspaceId, sourceUrl: string, storedUrl: string): Promise<void>;

  // System role (DB_SYSTEM): work across tenants.
  /**
   * Leases ready jobs (`run_after <= now`, lease free or expired) with `FOR UPDATE SKIP LOCKED`,
   * rotating the claim token (attempts are counted by `retryJob`, not here). Open jobs of disconnected connections are
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
  /** Releases the lease, counts the failed attempt and makes the job ready again at `runAfter`. */
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
  /**
   * Connections the push scans look at: status `connected` or `syncing`, with `pushOrders` and
   * `syncCustomers` from their settings (those with a switch on push; the others only have stale
   * claims released).
   */
  connectionsForPushScan(): Promise<
    Array<{
      workspaceId: WorkspaceId;
      connectionId: string;
      createdAt: Date;
      pushOrders: boolean;
      syncCustomers: boolean;
    }>
  >;
  connectionForSystem(id: string): Promise<ConnectionRecord | null>;
}

export const INTEGRATION_STORE = Symbol('INTEGRATION_STORE');
