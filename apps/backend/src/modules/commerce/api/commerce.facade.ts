import type { OrderDto } from '@agent-sales/contracts';
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
}

export const COMMERCE_FACADE = Symbol('COMMERCE_FACADE');
