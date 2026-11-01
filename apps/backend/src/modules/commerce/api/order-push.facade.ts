import { DomainError, type WorkspaceId } from '@agent-sales/shared';

import type { ExternalSource } from './catalog-sync.facade.js';

/** An order ready to send to a PMS (PMS-neutral; money in integer VND). */
export interface PushableOrder {
  id: string;
  code: string;
  placedAt: Date;
  /** Internal and printed notes joined, at most 500 characters. */
  note: string;
  lines: Array<{
    externalVariantId: string;
    sku: string;
    /** Product and variant name. */
    name: string;
    qty: number;
    unitPrice: number;
    lineDiscount: number;
  }>;
  /** The order's discount. */
  discount: number;
  /** What the customer pays for shipping. */
  shippingFee: number;
  total: number;
  customer: { name: string; phone: string | null };
  /** `address`: the full address text (street, ward, province). */
  recipient: { name: string; phone: string | null; address: string };
}

/** Why a pending order cannot be pushed; `name` is the first product not linked to the source. */
export type PushProblem = { reason: 'unlinked_product'; name: string } | { reason: 'empty' };

/**
 * Order push to a PMS (ADR-017, spec §7; used by `integration`). Eligible orders: not yet pushed
 * or claimed, live, not cancelled, created since `since`, and either staff orders or bot orders
 * approved at least 5 s ago (the approval undo window). Every call runs in one tenant transaction.
 */
export interface OrderPushFacade {
  /** Atomically moves up to `limit` eligible orders from external_state null to 'pending' and returns their ids. */
  claimOrdersForPush(
    ws: WorkspaceId,
    source: ExternalSource,
    since: Date,
    limit: number,
  ): Promise<string[]>;
  /**
   * The push payload of a pending order, or a problem that makes it unpushable (with the order
   * code, for the caller's log). Null when the
   * order does not exist or is not pending; a pending order cancelled or deleted since its claim
   * also loses the claim (back to no push state, so reviving it queues it again).
   */
  pushableOrder(
    ws: WorkspaceId,
    orderId: string,
  ): Promise<{ order: PushableOrder } | { problem: PushProblem; code: string } | null>;
  /**
   * Stores the PMS refs, `pushed`, from `pending`, `failed` or no claim; a held order gives its
   * hold back (one `release` movement per line) and its stock becomes the PMS's
   * (`stock_state = 'external'`). The same external id again is a no-op; another one throws
   * OrderAlreadyPushedError (the first refs stay). An external id already on another order throws
   * OrderExternalLinkConflictError. A cancelled order is still recorded (`cancelled: true`): the
   * caller must then cancel the PMS order or surface it.
   */
  markOrderPushed(
    ws: WorkspaceId,
    orderId: string,
    ref: { externalId: string; externalCode: string; externalStatus: string },
  ): Promise<{ cancelled: boolean }>;
  /** `pending` → `failed` with an i18n error code (PII-free params); any other state: no-op. */
  markOrderPushFailed(
    ws: WorkspaceId,
    orderId: string,
    error: { code: string; params?: Record<string, string | number> },
  ): Promise<void>;
  /** "Thử lại": failed → null so the next scan claims it again. 409 when not failed. */
  requeueOrderPush(ws: WorkspaceId, orderId: string): Promise<void>;
  /** order.update from the PMS: stores the status; a cancellation cancels the Rapiz order (history "Đơn đã huỷ trên KiotViet"). */
  applyExternalOrderStatus(
    ws: WorkspaceId,
    source: ExternalSource,
    externalId: string,
    status: { code: string; cancelled: boolean },
  ): Promise<'updated' | 'cancelled' | 'unknown'>;
  pushedOrderCount(ws: WorkspaceId, source: ExternalSource): Promise<number>;
  /**
   * Disconnect: every `pending` claim of the source goes back to no push state (so a later
   * connection claims it again); returns how many.
   */
  releasePendingPushes(ws: WorkspaceId, source: ExternalSource): Promise<number>;
  /**
   * Orders still `pending` whose claim (or last edit) is older than `olderThan`, oldest first: the
   * caller re-queues those its own queue lost (a crash between claim and enqueue).
   */
  stalePendingOrders(
    ws: WorkspaceId,
    source: ExternalSource,
    olderThan: Date,
    limit: number,
  ): Promise<string[]>;
}

export const ORDER_PUSH_FACADE = Symbol('ORDER_PUSH_FACADE');

/** The order is already in the PMS as another order; the first refs are kept. */
export class OrderAlreadyPushedError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(readonly externalCode: string | null) {
    super('The order was already pushed to the PMS', { reason: 'ALREADY_PUSHED', externalCode });
  }
}

/** The PMS order is already linked to another Rapiz order (unique `orders_external`). */
export class OrderExternalLinkConflictError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('The PMS order is already linked to another order', {
      reason: 'EXTERNAL_ORDER_LINK_RACE',
    });
  }
}
