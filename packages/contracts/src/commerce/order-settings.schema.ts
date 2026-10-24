import { z } from 'zod';

import {
  CLOSED_ORDER_STATUSES,
  OPTIONAL_ORDER_STATUSES,
  OrderSource,
  OrderStatus,
} from './commerce.schema.js';

// ─── Order settings and per-source field policies (T-024) ─────────────────────

/** Order fields a source's policy can require. */
export const ORDER_POLICY_FIELDS = [
  'customerPhone',
  'customerEmail',
  'recipientPhone',
  'recipientAddress',
] as const;
export const OrderPolicyField = z.enum(ORDER_POLICY_FIELDS);
export type OrderPolicyField = z.infer<typeof OrderPolicyField>;

/**
 * Statuses where the shop fulfils the order. Entering one (or creating an order
 * in one) checks the source's `confirm` fields as well as its `create` fields.
 */
export const FULFILMENT_ORDER_STATUSES = [
  ...CLOSED_ORDER_STATUSES,
  'delivery_failed',
  'returning',
] as const satisfies readonly OrderStatus[];

/** What one order source needs before an order can be saved, and before it is fulfilled. */
export const OrderSourcePolicy = z.object({
  source: OrderSource,
  create: z.array(OrderPolicyField),
  confirm: z.array(OrderPolicyField),
});
export type OrderSourcePolicy = z.infer<typeof OrderSourcePolicy>;

/**
 * A source's policy until the shop changes it: phone and walk-in sales may save a
 * draft without contact details; every source needs where to deliver before
 * fulfilment, except in-store sales.
 */
export function defaultOrderPolicy(source: OrderSource): OrderSourcePolicy {
  const delivery: OrderPolicyField[] = ['recipientPhone', 'recipientAddress'];
  if (source === 'store') return { source, create: [], confirm: [] };
  if (source === 'hotline') return { source, create: [], confirm: delivery };
  return { source, create: delivery, confirm: delivery };
}

export const OrderSettingsDto = z.object({
  extraStatuses: z.array(z.enum(OPTIONAL_ORDER_STATUSES)),
  /** Changing an order into one of these requires a note (every source). */
  requireNoteStatuses: z.array(OrderStatus),
  /** One entry per source; the server always returns all of them. */
  policies: z.array(OrderSourcePolicy),
  /**
   * Optimistic concurrency: send back the version you loaded; a save over a newer
   * version is refused with CONFLICT instead of silently overwriting it.
   */
  version: z.number().int().min(0),
});
export type OrderSettingsDto = z.infer<typeof OrderSettingsDto>;
