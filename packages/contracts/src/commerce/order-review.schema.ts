import { z } from 'zod';

import { Money } from './money.schema.js';

/** Review of an order the bot created: staff approve it before handling it like any other. */
export const OrderReviewState = z.enum(['pending', 'approved']);
export type OrderReviewState = z.infer<typeof OrderReviewState>;

export const OrderCreatedByKind = z.enum(['agent', 'bot', 'import', 'api']);
export type OrderCreatedByKind = z.infer<typeof OrderCreatedByKind>;

/** One line of the orders list's product column and its hover card. */
export const OrderItemPreview = z.object({
  name: z.string(),
  qty: z.number().int(),
  variantName: z.string().nullable(),
  unitPrice: Money,
  /** The product's current primary image. */
  imageUrl: z.string().nullable(),
});
export type OrderItemPreview = z.infer<typeof OrderItemPreview>;

/** Who created an order and, for bot orders, the source conversation and the staff review. */
export const OrderOriginFields = {
  createdByKind: OrderCreatedByKind,
  /** Null for orders that need no review (every order not created by the bot). */
  reviewState: OrderReviewState.nullable(),
  reviewedByName: z.string().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  conversationId: z.uuid().nullable(),
  /** How many lines the order has; `itemsPreview` carries at most the first 10. */
  itemCount: z.number().int().nonnegative(),
};

/** `approve:false` reverts an approval (same user, within a few seconds). */
export const ApproveOrderRequest = z.object({ approve: z.boolean() });
export type ApproveOrderRequest = z.infer<typeof ApproveOrderRequest>;

export const OrderReviewCountResponse = z.object({ pending: z.number().int().min(0) });
export type OrderReviewCountResponse = z.infer<typeof OrderReviewCountResponse>;
