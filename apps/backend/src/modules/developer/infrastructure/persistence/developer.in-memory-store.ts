import type { WorkspaceId } from '@agent-sales/shared';

import type {
  AttemptOutcome,
  DeliveryRecord,
  DeveloperStore,
  DeveloperSystemStore,
  DispatchLease,
  DueDelivery,
  EndpointRecord,
  PublicOutboxRow,
} from '../../application/ports/developer-store.js';

/**
 * Endpoints and deliveries in memory, for runs without a database and for tests. `outbox` is the
 * dispatcher's source: push rows into it; the position is the last id read.
 */
export class InMemoryDeveloperStore implements DeveloperStore, DeveloperSystemStore {
  readonly endpoints = new Map<string, EndpointRecord>();
  readonly deliveries = new Map<string, DeliveryRecord>();
  readonly outbox: PublicOutboxRow[] = [];
  #position = 0;

  listEndpoints(ws: WorkspaceId): Promise<EndpointRecord[]> {
    return Promise.resolve(
      [...this.endpoints.values()]
        .filter((r) => r.workspaceId === ws)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((r) => ({ ...r })),
    );
  }

  getEndpoint(ws: WorkspaceId, id: string): Promise<EndpointRecord | null> {
    const r = this.endpoints.get(id);
    return Promise.resolve(r && r.workspaceId === ws ? { ...r } : null);
  }

  insertEndpoint(r: EndpointRecord): Promise<void> {
    this.endpoints.set(r.id, { ...r });
    return Promise.resolve();
  }

  saveEndpoint(r: EndpointRecord, expectedVersion: number): Promise<boolean> {
    const cur = this.endpoints.get(r.id);
    if (!cur || cur.workspaceId !== r.workspaceId || cur.version !== expectedVersion) {
      return Promise.resolve(false);
    }
    this.endpoints.set(r.id, { ...r });
    return Promise.resolve(true);
  }

  deleteEndpoint(ws: WorkspaceId, id: string): Promise<boolean> {
    const cur = this.endpoints.get(id);
    if (!cur || cur.workspaceId !== ws) return Promise.resolve(false);
    this.endpoints.delete(id);
    for (const [k, v] of this.deliveries) if (v.endpointId === id) this.deliveries.delete(k);
    return Promise.resolve(true);
  }

  listDeliveries(
    ws: WorkspaceId,
    endpointId: string,
    q: {
      cursor?: string | undefined;
      limit: number;
      status?: DeliveryRecord['status'] | undefined;
    },
  ): Promise<{ rows: DeliveryRecord[]; nextCursor: string | null }> {
    const all = [...this.deliveries.values()]
      .filter(
        (r) =>
          r.workspaceId === ws &&
          r.endpointId === endpointId &&
          (!q.status || r.status === q.status),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
    const start = q.cursor ? all.findIndex((r) => r.id === q.cursor) + 1 : 0;
    const rows = all.slice(start, start + q.limit);
    const last = rows.at(-1);
    return Promise.resolve({
      rows: rows.map((r) => ({ ...r })),
      nextCursor: start + q.limit < all.length && last ? last.id : null,
    });
  }

  getDelivery(ws: WorkspaceId, id: string): Promise<DeliveryRecord | null> {
    const r = this.deliveries.get(id);
    return Promise.resolve(r && r.workspaceId === ws ? { ...r } : null);
  }

  insertDelivery(r: DeliveryRecord): Promise<void> {
    this.deliveries.set(r.id, { ...r });
    return Promise.resolve();
  }

  requeueDelivery(ws: WorkspaceId, id: string, at: Date): Promise<DeliveryRecord | null> {
    const r = this.deliveries.get(id);
    if (!r || r.workspaceId !== ws) return Promise.resolve(null);
    Object.assign(r, { status: 'pending', attempts: 0, nextAttemptAt: at, lastError: null });
    return Promise.resolve({ ...r });
  }

  async withDispatchLease<T>(fn: (lease: DispatchLease) => Promise<T>): Promise<T | null> {
    let read = this.#position;
    const result = await fn({
      readBatch: (types, afterId, limit) => {
        const rows = this.outbox
          .filter((r) => r.id > Math.max(afterId, this.#position) && types.includes(r.type))
          .sort((a, b) => a.id - b.id)
          .slice(0, limit);
        read = Math.max(read, ...rows.map((r) => r.id));
        return Promise.resolve(rows);
      },
      enabledEndpoints: (workspaces) =>
        Promise.resolve(
          [...this.endpoints.values()].filter(
            (r) => r.enabled && workspaces.includes(r.workspaceId),
          ),
        ),
      insertDeliveries: (rows) => {
        for (const r of rows) {
          const dup = [...this.deliveries.values()].some(
            (x) => x.endpointId === r.endpointId && x.eventId === r.eventId,
          );
          if (!dup) this.deliveries.set(r.id, { ...r });
        }
        return Promise.resolve();
      },
      commit: () => {
        this.#position = read;
        return Promise.resolve();
      },
    });
    return result;
  }

  claimDue(now: Date, limit: number, leaseMs: number): Promise<DueDelivery[]> {
    const due = [...this.deliveries.values()]
      .filter(
        (r) =>
          r.status === 'pending' &&
          r.nextAttemptAt !== null &&
          r.nextAttemptAt <= now &&
          this.endpoints.get(r.endpointId)?.enabled === true,
      )
      .sort((a, b) => (a.nextAttemptAt?.getTime() ?? 0) - (b.nextAttemptAt?.getTime() ?? 0))
      .slice(0, limit);
    return Promise.resolve(
      due.map((r) => {
        r.nextAttemptAt = new Date(now.getTime() + leaseMs);
        const ep = this.endpoints.get(r.endpointId) as EndpointRecord;
        return {
          delivery: { ...r },
          endpoint: {
            id: ep.id,
            url: ep.url,
            secretEncrypted: ep.secretEncrypted,
            previousSecretEncrypted: ep.previousSecretEncrypted,
            previousSecretExpiresAt: ep.previousSecretExpiresAt,
          },
        };
      }),
    );
  }

  recordAttempt(deliveryId: string, outcome: AttemptOutcome): Promise<void> {
    const r = this.deliveries.get(deliveryId);
    if (r) Object.assign(r, outcome);
    return Promise.resolve();
  }

  recordEndpointHealth(endpointId: string, ok: boolean, now: Date): Promise<Date | null> {
    const r = this.endpoints.get(endpointId);
    if (!r) return Promise.resolve(null);
    r.failingSince = ok ? null : (r.failingSince ?? now);
    return Promise.resolve(r.failingSince);
  }

  disableFailing(endpointId: string, now: Date): Promise<boolean> {
    const r = this.endpoints.get(endpointId);
    if (!r?.enabled) return Promise.resolve(false);
    Object.assign(r, {
      enabled: false,
      disabledReason: 'failing',
      version: r.version + 1,
      updatedAt: now,
    });
    return Promise.resolve(true);
  }
}
