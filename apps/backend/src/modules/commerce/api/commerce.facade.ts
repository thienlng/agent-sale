import type { OrderDto, OrderOverviewResponse } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** One line the bot wants to order: a catalog SKU and a quantity (prices come from the catalog). */
export interface BotOrderItemInput {
  sku: string;
  qty: number;
}

export interface BotOrderRecipient {
  name: string;
  phone: string;
  address: string;
}

export type BotOrderProblem = {
  code:
    | 'unknown_sku'
    | 'inactive'
    /** A course or a service (T-187): booked as a request, never ordered. */
    | 'not_sold'
    | 'insufficient_stock'
    | 'missing_name'
    | 'missing_phone'
    | 'invalid_phone'
    | 'missing_address';
  sku?: string;
  available?: number;
};

export type PrepareBotOrderResult =
  | { ok: true; summaryText: string; productIds: string[] }
  | { ok: false; problems: BotOrderProblem[] };

export type ConfirmBotOrderResult =
  | { ok: true; orderId: string; orderCode: string }
  | { ok: false; code: 'expired' | 'insufficient_stock' | 'nothing_pending' };

/** PUBLIC CONTRACT of the commerce module (inbox and bot use it from M3). */
export interface CommerceFacade {
  /** Throws NOT_FOUND when the order does not exist in the workspace. */
  getOrder(workspaceId: WorkspaceId, orderId: string): Promise<OrderDto>;
  /**
   * Validates the bot's order against the bot's catalog and stock and stores it as the
   * conversation's draft (replacing an earlier one); stores nothing on problems.
   */
  prepareBotOrder(
    ws: WorkspaceId,
    input: {
      botId: string;
      conversationId: string;
      channel: string;
      items: BotOrderItemInput[];
      recipient: BotOrderRecipient;
      note?: string;
      shippingFeeVnd: number | null;
    },
  ): Promise<PrepareBotOrderResult>;
  /** Takes the stored draft and creates the order (pending review) in one transaction. */
  confirmBotOrder(
    ws: WorkspaceId,
    input: { botId: string; botName: string; conversationId: string },
  ): Promise<ConfirmBotOrderResult>;
  /** Drops the conversation's draft; false when there was none. */
  cancelBotOrderDraft(ws: WorkspaceId, conversationId: string): Promise<boolean>;
  /** Whether an unexpired draft exists, and when it was stored. */
  hasBotOrderDraft(
    ws: WorkspaceId,
    conversationId: string,
  ): Promise<{ pending: boolean; storedAt: Date | null }>;

  // ─── Owner reports (T-172): figures only, never customer data ───

  /** The order overview of `GET /orders/overview` for local dates `from`..`to` (inclusive). */
  orderOverview(ws: WorkspaceId, q: { from: string; to: string }): Promise<OrderOverviewResponse>;
  /**
   * Orders placed in `[since, until)`, deleted and cancelled ones left out: how many, their total
   * (all of them, not only the listed ones) and the newest `limit` (≤ 10).
   */
  ordersPlaced(
    ws: WorkspaceId,
    q: { since: Date; until: Date; limit: number },
  ): Promise<OrdersPlaced>;
  /**
   * Variants of active products whose available stock (Σ on hand − reserved over warehouses) is at
   * most `threshold`, lowest first, at most `limit` (≤ 20). Variants without stock rows are not
   * counted, so a business that keeps no inventory has none.
   */
  lowStock(ws: WorkspaceId, q: { threshold: number; limit: number }): Promise<LowStock>;
  /**
   * When the newest order (not deleted or cancelled) of each of these conversations was created
   * (orders linked to a conversation: the bot's); conversations without one are absent. At most
   * 1 000 ids. For the Business Brain's Today ("ready" ends once an order exists).
   */
  latestOrderTimes(
    ws: WorkspaceId,
    conversationIds: readonly string[],
  ): Promise<ConversationTime[]>;
}

/** A conversation and a time. */
export interface ConversationTime {
  conversationId: string;
  at: Date;
}

export interface OrdersPlaced {
  count: number;
  total: number;
  items: {
    id: string;
    code: string;
    total: number;
    status: string;
    source: string;
    placedAt: string;
  }[];
}

export interface LowStock {
  count: number;
  items: {
    productId: string;
    variantId: string;
    name: string;
    sku: string | null;
    available: number;
  }[];
}

export const COMMERCE_FACADE = Symbol('COMMERCE_FACADE');
