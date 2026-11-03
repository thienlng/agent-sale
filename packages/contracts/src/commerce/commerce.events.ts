import { z } from 'zod';

import { OrderSource, OrderStatus } from './commerce.schema.js';

/**
 * Integration events published by the commerce module through the outbox (ADR-022 §7). Payloads
 * carry ids, codes, statuses and amounts only — never the customer's name, phone or address.
 */
const base = {
  workspaceId: z.uuid(),
  orderId: z.uuid(),
  code: z.string(),
  actorUserId: z.uuid().nullable(),
  occurredAt: z.iso.datetime(),
};

export const OrderCreatedV1 = z.object({
  type: z.literal('commerce.order.created.v1'),
  ...base,
  status: OrderStatus,
  source: OrderSource,
  contactId: z.uuid().nullable(),
  /** "Tiền cần thu" in VND. */
  total: z.number().int(),
  itemQty: z.number().int(),
});
export type OrderCreatedV1 = z.infer<typeof OrderCreatedV1>;

export const OrderStatusChangedV1 = z.object({
  type: z.literal('commerce.order.status_changed.v1'),
  ...base,
  fromStatus: OrderStatus.nullable(),
  toStatus: OrderStatus,
});
export type OrderStatusChangedV1 = z.infer<typeof OrderStatusChangedV1>;

export const CommerceEvents = z.discriminatedUnion('type', [OrderCreatedV1, OrderStatusChangedV1]);
export type CommerceEvent = z.infer<typeof CommerceEvents>;
