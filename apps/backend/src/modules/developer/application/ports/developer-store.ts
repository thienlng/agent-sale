import type { WebhookDeliveryStatus } from '@agent-sales/contracts';
import type { UserId, WorkspaceId } from '@agent-sales/shared';

export interface EndpointRecord {
  id: string;
  workspaceId: WorkspaceId;
  url: string;
  description: string;
  /** Public event types. */
  events: string[];
  /** `whsec_…` sealed with SecretBox. */
  secretEncrypted: string;
  previousSecretEncrypted: string | null;
  previousSecretExpiresAt: Date | null;
  enabled: boolean;
  disabledReason: 'failing' | 'manual' | null;
  failingSince: Date | null;
  createdBy: UserId;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeliveryRecord {
  id: string;
  workspaceId: WorkspaceId;
  endpointId: string;
  eventId: string;
  eventType: string;
  /** The envelope `{ id, type, workspaceId, occurredAt, data }`. */
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  lastStatusCode: number | null;
  lastError: string | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

/** Workspace-scoped persistence of endpoints and their delivery log (row-level security). */
export interface DeveloperStore {
  listEndpoints(ws: WorkspaceId): Promise<EndpointRecord[]>;
  getEndpoint(ws: WorkspaceId, id: string): Promise<EndpointRecord | null>;
  insertEndpoint(r: EndpointRecord): Promise<void>;
  /** Writes `r` (with `r.version` already bumped) when the stored version is `expectedVersion`. */
  saveEndpoint(r: EndpointRecord, expectedVersion: number): Promise<boolean>;
  deleteEndpoint(ws: WorkspaceId, id: string): Promise<boolean>;
  /** Newest first; the cursor is opaque. */
  listDeliveries(
    ws: WorkspaceId,
    endpointId: string,
    q: { cursor?: string | undefined; limit: number; status?: WebhookDeliveryStatus | undefined },
  ): Promise<{ rows: DeliveryRecord[]; nextCursor: string | null }>;
  getDelivery(ws: WorkspaceId, id: string): Promise<DeliveryRecord | null>;
  insertDelivery(r: DeliveryRecord): Promise<void>;
  /** Puts a delivery back to `pending`, due at `at`, with its attempts reset. */
  requeueDelivery(ws: WorkspaceId, id: string, at: Date): Promise<DeliveryRecord | null>;
}
export const DEVELOPER_STORE = Symbol('DEVELOPER_STORE');

/** One outbox row the dispatcher reads. */
export interface PublicOutboxRow {
  id: number;
  workspaceId: WorkspaceId;
  type: string;
  payload: unknown;
  createdAt: Date;
}

/** The dispatcher's exclusive pass over the outbox (transaction horizon, like the HQ sync). */
export interface DispatchLease {
  readBatch(types: readonly string[], afterId: number, limit: number): Promise<PublicOutboxRow[]>;
  /** Enabled endpoints of the workspaces. */
  enabledEndpoints(workspaces: readonly WorkspaceId[]): Promise<EndpointRecord[]>;
  /** Inserts deliveries; an (endpoint, event) already queued is skipped. */
  insertDeliveries(rows: readonly DeliveryRecord[]): Promise<void>;
  /** Moves the position to the horizon of this pass. */
  commit(): Promise<void>;
}

/** A due delivery with what the sender needs of its endpoint. */
export interface DueDelivery {
  delivery: DeliveryRecord;
  endpoint: Pick<
    EndpointRecord,
    'id' | 'url' | 'secretEncrypted' | 'previousSecretEncrypted' | 'previousSecretExpiresAt'
  >;
}

/** What one send attempt did. */
export interface AttemptOutcome {
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  lastStatusCode: number | null;
  lastError: string | null;
  deliveredAt: Date | null;
}

/** Cross-tenant work of the worker (app_system). */
export interface DeveloperSystemStore {
  /** Null when another worker holds the dispatcher. */
  withDispatchLease<T>(fn: (lease: DispatchLease) => Promise<T>): Promise<T | null>;
  /**
   * Claims up to `limit` pending deliveries due at `now` on enabled endpoints, pushing their
   * `next_attempt_at` to `now + leaseMs` so no other worker sends them meanwhile.
   */
  claimDue(now: Date, limit: number, leaseMs: number): Promise<DueDelivery[]>;
  recordAttempt(deliveryId: string, outcome: AttemptOutcome): Promise<void>;
  /**
   * Success clears `failing_since`; a failure sets it if unset. Returns the endpoint's
   * `failing_since` after the update (null when healthy or gone).
   */
  recordEndpointHealth(endpointId: string, ok: boolean, now: Date): Promise<Date | null>;
  /** Disables an endpoint that kept failing; false when it was already disabled. */
  disableFailing(endpointId: string, now: Date): Promise<boolean>;
}
export const DEVELOPER_SYSTEM_STORE = Symbol('DEVELOPER_SYSTEM_STORE');
