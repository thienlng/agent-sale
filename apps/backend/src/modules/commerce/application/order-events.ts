import type { OrderCreatedV1, OrderStatusChangedV1 } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

import type { OrderStatus } from '../domain/order-stock.js';
import type { CommerceTx, OrderRecord } from './ports/commerce-store.js';

/**
 * Order integration events (ADR-022 §7), written in the transaction that changed the order.
 * Payloads carry ids, codes, statuses and amounts only — never the customer's name or phone.
 * Orders are not linked to a CRM customer yet, so `contactId` is always null.
 */
export async function publishOrderCreated(
  tx: CommerceTx,
  ws: WorkspaceId,
  o: OrderRecord,
  actorUserId: string | null,
): Promise<void> {
  const payload: Omit<OrderCreatedV1, 'type'> = {
    workspaceId: ws,
    orderId: o.id,
    code: o.code,
    actorUserId,
    occurredAt: o.createdAt.toISOString(),
    status: o.status,
    source: o.source as OrderCreatedV1['source'],
    contactId: null,
    total: o.total,
    itemQty: o.itemQty,
  };
  await tx.outbox.write(ws, { type: 'commerce.order.created.v1', aggregateId: o.id, payload });
}

export async function publishOrderStatusChanged(
  tx: CommerceTx,
  ws: WorkspaceId,
  o: OrderRecord,
  fromStatus: OrderStatus,
  actorUserId: string | null,
  at: Date,
): Promise<void> {
  if (fromStatus === o.status) return;
  const payload: Omit<OrderStatusChangedV1, 'type'> = {
    workspaceId: ws,
    orderId: o.id,
    code: o.code,
    actorUserId,
    occurredAt: at.toISOString(),
    fromStatus: fromStatus,
    toStatus: o.status,
  };
  await tx.outbox.write(ws, {
    type: 'commerce.order.status_changed.v1',
    aggregateId: o.id,
    payload,
  });
}
