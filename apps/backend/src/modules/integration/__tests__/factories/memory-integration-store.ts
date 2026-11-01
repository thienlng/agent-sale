import type { WorkspaceId } from '@agent-sales/shared';

import type {
  ConnectionRecord,
  IntegrationProvider,
  IntegrationStore,
  SyncJobKind,
  SyncLogEntry,
  SyncLogLevel,
} from '../../application/ports/integration-store.js';
import {
  ConnectionExistsError,
  ConnectionNotFoundError,
  ConnectionVersionConflictError,
} from '../../domain/integration.errors.js';

const OWNER_FIELDS = ['settings', 'retailer', 'clientId', 'clientSecretSealed'] as const;
const IGNORED = ['id', 'workspaceId', 'provider', 'version', 'createdAt', 'updatedAt'] as const;

export interface MemoryJob {
  id: string;
  workspaceId: WorkspaceId;
  connectionId: string;
  kind: SyncJobKind;
  payload: Record<string, unknown>;
  open: boolean;
  cursor?: Record<string, unknown> | null;
}

/**
 * In-memory IntegrationStore for service and DB-less HTTP tests: the tenant-scoped connection,
 * job and log methods with the Drizzle adapter's rules (live uniqueness, owner-only version bumps,
 * one open full import/reconcile). The system-role job methods are not modelled.
 */
export class MemoryIntegrationStore implements IntegrationStore {
  readonly connections: ConnectionRecord[] = [];
  readonly jobs: MemoryJob[] = [];
  readonly logs: Array<SyncLogEntry & { connectionId: string; workspaceId: WorkspaceId }> = [];
  private seq = 0;

  liveConnection(ws: WorkspaceId, provider: IntegrationProvider) {
    const found = this.connections.find(
      (c) => c.workspaceId === ws && c.provider === provider && c.status !== 'disconnected',
    );
    return Promise.resolve(found ? structuredClone(found) : null);
  }

  async insertConnection(ws: WorkspaceId, c: ConnectionRecord) {
    if (await this.liveConnection(ws, c.provider)) throw new ConnectionExistsError(c.provider);
    this.connections.push(structuredClone({ ...c, workspaceId: ws }));
  }

  updateConnection(
    ws: WorkspaceId,
    id: string,
    patch: Partial<ConnectionRecord>,
    expectedVersion?: number,
  ) {
    const row = this.connections.find((c) => c.workspaceId === ws && c.id === id);
    if (!row) return Promise.reject(new ConnectionNotFoundError('kiotviet'));
    if (expectedVersion !== undefined && row.version !== expectedVersion) {
      return Promise.reject(new ConnectionVersionConflictError());
    }
    const clean: Partial<ConnectionRecord> = structuredClone(patch);
    for (const k of IGNORED) delete clean[k];
    const bump = OWNER_FIELDS.some((k) => k in clean);
    Object.assign(row, clean, {
      version: bump ? row.version + 1 : row.version,
      updatedAt: new Date(),
    });
    return Promise.resolve(structuredClone(row));
  }

  enqueue(
    ws: WorkspaceId,
    job: { connectionId: string; kind: SyncJobKind; payload?: Record<string, unknown> },
  ) {
    const exclusive = job.kind === 'full_import' || job.kind === 'reconcile';
    const busy = this.jobs.some(
      (j) =>
        j.open &&
        j.connectionId === job.connectionId &&
        (j.kind === 'full_import' || j.kind === 'reconcile'),
    );
    if (exclusive && busy) return Promise.resolve(false);
    this.jobs.push({
      id: `mem-job-${this.jobs.length + 1}`,
      workspaceId: ws,
      connectionId: job.connectionId,
      kind: job.kind,
      payload: job.payload ?? {},
      open: true,
    });
    return Promise.resolve(true);
  }

  log(
    ws: WorkspaceId,
    connectionId: string,
    e: { level: SyncLogLevel; code: string; params?: Record<string, string | number> },
  ) {
    this.seq += 1;
    const id = `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`;
    this.logs.push({
      id,
      workspaceId: ws,
      connectionId,
      level: e.level,
      code: e.code,
      params: e.params ?? {},
      at: new Date(Date.now() + this.seq),
    });
    return Promise.resolve();
  }

  recentLog(ws: WorkspaceId, connectionId: string, limit: number) {
    return Promise.resolve(
      this.logs
        .filter((l) => l.workspaceId === ws && l.connectionId === connectionId)
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, limit)
        .map(({ id, level, code, params, at }) => ({ id, level, code, params, at })),
    );
  }

  latestPushJob: IntegrationStore['latestPushJob'] = (ws, orderId) => {
    const found = this.jobs
      .filter(
        (j) => j.workspaceId === ws && j.kind === 'push_order' && j.payload['orderId'] === orderId,
      )
      .at(-1);
    return Promise.resolve(
      found
        ? {
            open: found.open,
            payload: structuredClone(found.payload),
            cursor: found.cursor ?? null,
          }
        : null,
    );
  };

  cachedImage: IntegrationStore['cachedImage'] = () => Promise.resolve(null);
  cacheImage: IntegrationStore['cacheImage'] = () => Promise.resolve();

  claimJobs: IntegrationStore['claimJobs'] = notModelled;
  saveCursor: IntegrationStore['saveCursor'] = notModelled;
  completeJob: IntegrationStore['completeJob'] = notModelled;
  retryJob: IntegrationStore['retryJob'] = notModelled;
  failJob: IntegrationStore['failJob'] = notModelled;
  claimWebhookEvents: IntegrationStore['claimWebhookEvents'] = notModelled;
  connectionsDueForReconcile: IntegrationStore['connectionsDueForReconcile'] = notModelled;
  connectionForSystem: IntegrationStore['connectionForSystem'] = notModelled;

  connectionsPushingOrders: IntegrationStore['connectionsPushingOrders'] = () =>
    Promise.resolve(
      this.connections
        .filter(
          (c) => c.settings.pushOrders && (c.status === 'connected' || c.status === 'syncing'),
        )
        .map((c) => ({ workspaceId: c.workspaceId, connectionId: c.id, createdAt: c.createdAt })),
    );
}

function notModelled(): Promise<never> {
  return Promise.reject(new Error('not modelled by MemoryIntegrationStore'));
}
