import type { ConnectionDto, SyncProgress } from '@agent-sales/contracts';

import type { ConnectionRecord, ConnectionSettings } from './ports/integration-store.js';

/** The API view of a connection (`ConnectionDto`): no secrets, ever. */

const PROVIDER = 'kiotviet';
const PROGRESS_PHASES: ReadonlySet<string> = new Set([
  'branches',
  'categories',
  'products',
  'stock',
]);

const maskClientId = (clientId: string): string => `••••${clientId.slice(-4)}`;

function latest(...dates: Array<Date | null>): Date | null {
  return dates.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);
}

function progressOf(p: ConnectionRecord['progress']): SyncProgress | null {
  if (!p || !PROGRESS_PHASES.has(p.phase)) return null;
  return { phase: p.phase as SyncProgress['phase'], done: p.done, total: p.total };
}

function settingsOf(s: ConnectionSettings): ConnectionDto['settings'] {
  return {
    saleBranchIds: s.saleBranchIds,
    orderBranchId: s.orderBranchId,
    pushOrders: s.pushOrders,
    syncCustomers: s.syncCustomers,
  };
}

/** The API view of a connection: no secrets, the client id masked to its last 4 characters. */
export function toDto(c: ConnectionRecord): ConnectionDto {
  const lastSync = latest(c.lastFullSyncAt, c.lastReconcileAt);
  return {
    id: c.id,
    provider: PROVIDER,
    status: c.status,
    retailer: c.retailer,
    clientIdMasked: maskClientId(c.clientId),
    settings: settingsOf(c.settings),
    branches: c.settings.branches ?? [],
    counts: {
      products: c.counts.products ?? 0,
      customers: c.counts.customers ?? 0,
      ordersPushed: c.counts.ordersPushed ?? 0,
    },
    progress: progressOf(c.progress),
    lastSyncAt: lastSync ? lastSync.toISOString() : null,
    lastError: c.lastError,
    version: c.version,
  };
}
