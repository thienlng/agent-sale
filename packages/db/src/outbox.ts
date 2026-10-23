import type { WorkspaceId } from '@agent-sales/shared';

import { outboxEvents } from './schema/platform.js';
import type { TenantTx } from './tenant.js';

export interface OutboxRecord {
  workspaceId: WorkspaceId | null;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/**
 * Writes an integration event in the caller's transaction (transactional
 * outbox, docs/ARCHITECTURE.md §2). The outbox relay publishes it later.
 */
export async function writeOutbox(tx: TenantTx, record: OutboxRecord): Promise<void> {
  await tx.insert(outboxEvents).values({
    workspaceId: record.workspaceId,
    type: record.type,
    aggregateType: record.aggregateType,
    aggregateId: record.aggregateId,
    payload: record.payload,
  });
}
