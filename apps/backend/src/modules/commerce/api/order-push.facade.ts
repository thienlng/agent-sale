import type { WorkspaceId } from '@agent-sales/shared';

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
   * The push payload of a pending order, or a problem that makes it unpushable. Null when the
   * order does not exist, is not pending, or was cancelled meanwhile (nothing to push).
   */
  pushableOrder(
    ws: WorkspaceId,
    orderId: string,
  ): Promise<{ order: PushableOrder } | { problem: PushProblem } | null>;
  /**
   * Stores the PMS refs, `pushed`; a held order gives its hold back (one `release` movement per
   * line) and its stock becomes the PMS's (`stock_state = 'external'`). Idempotent.
   */
  markOrderPushed(
    ws: WorkspaceId,
    orderId: string,
    ref: { externalId: string; externalCode: string; externalStatus: string },
  ): Promise<void>;
  /** `failed` with an i18n error code (PII-free params); a pushed order is left as it is. */
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
}

export const ORDER_PUSH_FACADE = Symbol('ORDER_PUSH_FACADE');
