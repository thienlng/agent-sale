import type { ToolDefinition } from '@agent-sales/ai-core';
import type { WorkspaceId } from '@agent-sales/shared';
import { z } from 'zod';

import type { CommerceFacade } from '../../commerce/api/index.js';
import type { MessageSink, OutgoingMessage, QuickReply } from '../api/reply-options.js';
import { safeJson } from './action-tools.js';
import type { OutputState } from './output-tools.js';
import type { RunnableTool } from './tool-runner.js';

export const PREPARE_ORDER_TOOL = 'prepare_order';
export const CONFIRM_ORDER_TOOL = 'confirm_order';
export const CANCEL_ORDER_DRAFT_TOOL = 'cancel_order_draft';

/** The buttons under the order summary (spec §4.4); tapping one sends its title as text. */
export const ORDER_QUICK_REPLIES: readonly QuickReply[] = [
  { title: '✅ Đặt hàng', payload: 'ORDER_CONFIRM' },
  { title: '✏️ Sửa thông tin', payload: 'ORDER_EDIT' },
];

/** The order source when the caller names no channel (the dashboard playground). */
export const PLAYGROUND_ORDER_CHANNEL = 'other';

const PrepareOrderInput = z.object({
  items: z
    .array(
      z.object({ sku: z.string().trim().min(1).max(100), qty: z.number().int().min(1).max(99) }),
    )
    .min(1)
    .max(20),
  // Empty values are allowed: the server answers with `missing_*` problems the model can ask about.
  recipient: z.object({
    name: z.string().max(120),
    phone: z.string().max(40),
    address: z.string().max(300),
  }),
  note: z.string().max(300).optional(),
});

const PREPARE_DEFINITION: ToolDefinition = {
  name: PREPARE_ORDER_TOOL,
  description:
    'Prepares an order once the customer clearly wants to buy and you know the products (sku from product details), quantities and the recipient name, phone and delivery address. The server checks stock, computes the prices and sends the customer the order summary with "Đặt hàng" / "Sửa thông tin" buttons; never restate the summary. Returns problems to ask the customer about, or that the order waits for the customer to confirm.',
  input: PrepareOrderInput,
};

const CONFIRM_DEFINITION: ToolDefinition = {
  name: CONFIRM_ORDER_TOOL,
  description:
    'The customer agreed to the order summary sent earlier ("Đặt hàng", "ok", "chốt"): creates the order exactly as summarised and returns its code.',
  input: z.object({}),
};

const CANCEL_DEFINITION: ToolDefinition = {
  name: CANCEL_ORDER_DRAFT_TOOL,
  description:
    'The customer wants to change or drop the order summary sent earlier: discards it. To change something, prepare the order again with the new details.',
  input: z.object({}),
};

/** What one turn's order tools need; built by the reply pipeline only for bots that take orders. */
export interface OrderToolContext {
  facade: CommerceFacade;
  ws: WorkspaceId;
  bot: { id: string; name: string; orderShippingFeeVnd?: number | null };
  /** A UUID: the real conversation, or the stable per-bot playground id. */
  conversationId: string;
  /** The order source: the conversation's channel. */
  channel: string;
  /** Absent: the summary is collected (playground), like `send_message`. */
  sink?: MessageSink;
  output: OutputState;
  /** A draft stored before the customer's newest message: the only one this turn can confirm or cancel. */
  confirmable: boolean;
  state: OrderToolState;
}

export interface OrderToolState {
  /** A draft was stored this turn: it cannot be confirmed in the same turn. */
  stored: boolean;
  /** A summary send was attempted this turn: a second one is refused (no duplicate summaries). */
  summarySent: boolean;
  /** `confirm_order` created an order this turn: its final message must reach the customer. */
  orderCreated: boolean;
}

export const newOrderToolState = (): OrderToolState => ({
  stored: false,
  summarySent: false,
  orderCreated: false,
});

/**
 * The time a draft must predate to be confirmable: the customer's newest message (an "ok" written
 * before the summary arrived answers something else), or the turn start when times are unknown.
 */
export function confirmCutoff(
  messages: readonly { role: string }[],
  times: readonly Date[] | undefined,
  turnStartedAt: Date,
): Date {
  if (!times || times.length !== messages.length) return turnStartedAt;
  for (let i = messages.length - 1; i >= 0; i--)
    if (messages[i]?.role === 'customer') return times[i] ?? turnStartedAt;
  return turnStartedAt;
}

/**
 * Whether the conversation's draft can be confirmed by this turn: it must have been stored before
 * `cutoff` (the customer has seen the summary since), the same rule as pending actions. A failed
 * check means "not confirmable" (`onError` gets the error to log its class).
 */
export async function confirmableDraft(
  facade: CommerceFacade,
  ws: WorkspaceId,
  conversationId: string,
  cutoff: Date,
  onError?: (error: unknown) => void,
): Promise<boolean> {
  try {
    const draft = await facade.hasBotOrderDraft(ws, conversationId);
    return draft.pending && draft.storedAt !== null && draft.storedAt < cutoff;
  } catch (error) {
    onError?.(error);
    return false;
  }
}

const reply = (value: unknown, ok = true) => ({ content: safeJson(value), ok });

/**
 * `prepare_order`, plus `confirm_order` / `cancel_order_draft` while a draft from an earlier turn
 * waits (spec §4.1). The model never sets a price, and confirming never reads its arguments.
 */
export function orderTools(ctx: OrderToolContext): {
  definitions: ToolDefinition[];
  runnable: RunnableTool[];
} {
  const { facade, ws, conversationId, state } = ctx;
  const dropDraft = async (): Promise<void> => {
    await facade.cancelBotOrderDraft(ws, conversationId);
    state.stored = false;
  };

  const prepare: RunnableTool = {
    name: PREPARE_ORDER_TOOL,
    readOnly: false,
    schema: PrepareOrderInput,
    run: async (input) => {
      const args = input as z.infer<typeof PrepareOrderInput>;
      // One summary per turn: a second one would stack buttons for two different drafts.
      if (state.summarySent) return reply({ ok: false, error: 'already_sent' }, false);
      const res = await facade.prepareBotOrder(ws, {
        botId: ctx.bot.id,
        conversationId,
        channel: ctx.channel,
        items: args.items,
        recipient: args.recipient,
        ...(args.note?.trim() ? { note: args.note.trim() } : {}),
        shippingFeeVnd: ctx.bot.orderShippingFeeVnd ?? null,
      });
      if (!res.ok) return reply({ ok: false, problems: res.problems }, false);
      state.stored = true;
      // The server, not the model, delivers the summary with the confirm / edit buttons.
      const message: OutgoingMessage = {
        text: res.summaryText,
        images: [],
        quickReplies: ORDER_QUICK_REPLIES.map((q) => ({ ...q })),
      };
      state.summarySent = true;
      let sent: { delivered: number; complete?: boolean } = { delivered: 1 };
      try {
        if (ctx.sink) sent = await ctx.sink.send(message);
      } catch (error) {
        await dropDraft();
        throw error;
      }
      if (sent.delivered <= 0 || sent.complete === false) {
        // The customer never saw the whole summary: their next "ok" must not confirm it.
        await dropDraft();
        return reply({ ok: false, error: 'not_delivered' }, false);
      }
      ctx.output.sent.push({
        text: res.summaryText,
        images: [],
        quickReplies: message.quickReplies ?? [],
        via: 'send_message',
      });
      return {
        ...reply({ ok: true, status: 'awaiting_customer_confirmation' }),
        productIds: res.productIds,
      };
    },
  };

  const confirm: RunnableTool = {
    name: CONFIRM_ORDER_TOOL,
    readOnly: false,
    schema: z.object({}),
    // Never the model's arguments: only the draft the customer was shown.
    run: async () => {
      if (!ctx.confirmable || state.stored)
        return reply({ ok: false, code: 'not_confirmable' }, false);
      const res = await facade.confirmBotOrder(ws, {
        botId: ctx.bot.id,
        botName: ctx.bot.name,
        conversationId,
      });
      if (!res.ok) return reply({ ok: false, code: res.code }, false);
      state.orderCreated = true;
      return reply({ ok: true, orderCode: res.orderCode });
    },
  };

  const cancel: RunnableTool = {
    name: CANCEL_ORDER_DRAFT_TOOL,
    readOnly: false,
    schema: z.object({}),
    run: async () => {
      if (!ctx.confirmable || state.stored)
        return reply({ ok: false, code: 'nothing_pending' }, false);
      const dropped = await facade.cancelBotOrderDraft(ws, conversationId);
      return dropped
        ? reply({ ok: true, status: 'cancelled' })
        : reply({ ok: false, code: 'nothing_pending' }, false);
    },
  };

  return ctx.confirmable
    ? {
        definitions: [PREPARE_DEFINITION, CONFIRM_DEFINITION, CANCEL_DEFINITION],
        runnable: [prepare, confirm, cancel],
      }
    : { definitions: [PREPARE_DEFINITION], runnable: [prepare] };
}
