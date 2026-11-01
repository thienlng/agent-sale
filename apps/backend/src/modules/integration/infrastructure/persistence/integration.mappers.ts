import type { schema } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type { ConnectionRecord } from '../../application/ports/integration-store.js';

type Connections = typeof schema.integrationConnections;

/** Row ↔ record mapping of `integration_connections`. */
type ConnectionRow = Connections['$inferSelect'];

export function toConnection(r: ConnectionRow): ConnectionRecord {
  return {
    id: r.id,
    workspaceId: r.workspaceId as WorkspaceId,
    provider: r.provider,
    status: r.status,
    retailer: r.retailer,
    clientId: r.clientId,
    clientSecretSealed: r.clientSecretSealed,
    webhookToken: r.webhookToken,
    webhookSecretSealed: r.webhookSecretSealed,
    settings: r.settings as unknown as ConnectionRecord['settings'],
    version: r.version,
    progress: (r.progress ?? null) as ConnectionRecord['progress'],
    counts: (r.counts ?? {}) as ConnectionRecord['counts'],
    lastError: (r.lastError ?? null) as ConnectionRecord['lastError'],
    lastFullSyncAt: r.lastFullSyncAt,
    lastReconcileAt: r.lastReconcileAt,
    connectedByUserId: r.connectedByUserId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Columns a patch may write; identity, version and timestamps are owned by the store. */
export function patchColumns(
  patch: Partial<ConnectionRecord>,
): Partial<Connections['$inferInsert']> {
  const set: Partial<Connections['$inferInsert']> = {};
  if (patch.status !== undefined) {
    set.status = patch.status;
    set.disconnectedAt = patch.status === 'disconnected' ? new Date() : null;
  }
  if (patch.retailer !== undefined) set.retailer = patch.retailer;
  if (patch.clientId !== undefined) set.clientId = patch.clientId;
  if (patch.clientSecretSealed !== undefined) set.clientSecretSealed = patch.clientSecretSealed;
  if (patch.webhookToken !== undefined) set.webhookToken = patch.webhookToken;
  if (patch.webhookSecretSealed !== undefined) set.webhookSecretSealed = patch.webhookSecretSealed;
  if (patch.settings !== undefined) set.settings = { ...patch.settings };
  if (patch.progress !== undefined) set.progress = patch.progress;
  if (patch.counts !== undefined) set.counts = { ...patch.counts };
  if (patch.lastError !== undefined) set.lastError = patch.lastError;
  if (patch.lastFullSyncAt !== undefined) set.lastFullSyncAt = patch.lastFullSyncAt;
  if (patch.lastReconcileAt !== undefined) set.lastReconcileAt = patch.lastReconcileAt;
  if (patch.connectedByUserId !== undefined) set.connectedByUserId = patch.connectedByUserId;
  return set;
}
