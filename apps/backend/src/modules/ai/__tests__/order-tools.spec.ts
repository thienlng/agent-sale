import { readFile } from 'node:fs/promises';

import {
  FakeLlmProvider,
  type GenerateRequest,
  type GenerateResponse,
  type LlmProvider,
  PROMPTS_DIR,
} from '@agent-sales/ai-core';
import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { CommerceFacade, PrepareBotOrderResult } from '../../commerce/api/index.js';
import type { KnowledgeFacade } from '../../knowledge/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import type { OutgoingMessage } from '../api/reply-options.js';
import { playgroundConversationId } from '../application/action-tools.js';
import { LlmRuntime } from '../application/llm-runtime.js';
import {
  CANCEL_ORDER_DRAFT_TOOL,
  CONFIRM_ORDER_TOOL,
  confirmableDraft,
  newOrderToolState,
  ORDER_QUICK_REPLIES,
  type OrderToolContext,
  orderTools,
  PREPARE_ORDER_TOOL,
} from '../application/order-tools.js';
import { newOutputState } from '../application/output-tools.js';
import { PlaygroundService } from '../application/playground.service.js';
import type { LlmProviderFactory } from '../application/ports/llm-provider-factory.js';
import { InMemoryAiRunRepository } from '../infrastructure/persistence/ai-run.repositories.js';
import { InMemoryLlmConfigRepository } from '../infrastructure/persistence/llm-config.in-memory-repository.js';

const ws = workspaceId(newId());
const botId = newId();
const conversationId = newId();

const SUMMARY = 'Dạ em tóm tắt đơn của mình ạ:\n• Thú gỗ ×2 — 1.760.000đ\nTổng: 1.760.000đ';
const ORDER_INPUT = {
  items: [{ sku: 'TOY-1', qty: 2 }],
  recipient: { name: 'Lan', phone: '0912345678', address: '12 Lý Thường Kiệt' },
};

/** A fake commerce facade with one draft slot, like the `bot_order_drafts` row. */
function fakeCommerce(
  opts: { prepare?: PrepareBotOrderResult; storedAt?: Date | null } = {},
): CommerceFacade & { draft: { storedAt: Date } | null } {
  const facade = {
    draft: opts.storedAt ? { storedAt: opts.storedAt } : null,
    getOrder: vi.fn(),
    prepareBotOrder: vi.fn(async () => {
      const res = opts.prepare ?? { ok: true, summaryText: SUMMARY, productIds: ['toy-1'] };
      if (res.ok) facade.draft = { storedAt: new Date() };
      return res;
    }),
    confirmBotOrder: vi.fn(async () => {
      if (!facade.draft) return { ok: false as const, code: 'nothing_pending' as const };
      facade.draft = null;
      return { ok: true as const, orderId: newId(), orderCode: 'DH0042' };
    }),
    cancelBotOrderDraft: vi.fn(async () => {
      const had = facade.draft !== null;
      facade.draft = null;
      return had;
    }),
    hasBotOrderDraft: vi.fn(async () => ({
      pending: facade.draft !== null,
      storedAt: facade.draft?.storedAt ?? null,
    })),
  };
  return facade as unknown as CommerceFacade & { draft: { storedAt: Date } | null };
}

const recordingSink = (delivered = 1) => {
  const sent: OutgoingMessage[] = [];
  return { sent, send: async (m: OutgoingMessage) => (sent.push(m), { delivered }) };
};

function context(facade: CommerceFacade, extra: Partial<OrderToolContext> = {}): OrderToolContext {
  return {
    facade,
    ws,
    bot: { id: botId, name: 'Rapiz Bot', orderShippingFeeVnd: 30_000 },
    conversationId,
    channel: 'facebook',
    output: newOutputState(),
    confirmable: false,
    state: newOrderToolState(),
    ...extra,
  };
}

const runnable = (ctx: OrderToolContext, name: string) => {
  const tool = orderTools(ctx).runnable.find((t) => t.name === name);
  if (!tool) throw new Error(`no ${name}`);
  return tool;
};

describe('order tools (spec §4.1)', () => {
  it('offers only prepare_order without a draft from an earlier turn', () => {
    const ctx = context(fakeCommerce());
    expect(orderTools(ctx).definitions.map((d) => d.name)).toEqual([PREPARE_ORDER_TOOL]);
    expect(orderTools({ ...ctx, confirmable: true }).definitions.map((d) => d.name)).toEqual([
      PREPARE_ORDER_TOOL,
      CONFIRM_ORDER_TOOL,
      CANCEL_ORDER_DRAFT_TOOL,
    ]);
  });

  it('prepare sends exactly one summary message with both quick replies, then awaits confirmation', async () => {
    const facade = fakeCommerce();
    const sink = recordingSink();
    const ctx = context(facade, { sink });
    const out = await runnable(ctx, PREPARE_ORDER_TOOL).run({ ...ORDER_INPUT, note: ' ' });

    expect(sink.sent).toEqual([
      {
        text: SUMMARY,
        images: [],
        quickReplies: [
          { title: '✅ Đặt hàng', payload: 'ORDER_CONFIRM' },
          { title: '✏️ Sửa thông tin', payload: 'ORDER_EDIT' },
        ],
      },
    ]);
    expect(JSON.parse(out.content)).toEqual({ ok: true, status: 'awaiting_customer_confirmation' });
    expect(out.productIds).toEqual(['toy-1']);
    // Counts as a delivered send_message for the reply decision.
    expect(ctx.output.sent).toEqual([
      { text: SUMMARY, images: [], quickReplies: [...ORDER_QUICK_REPLIES], via: 'send_message' },
    ]);
    expect(facade.prepareBotOrder).toHaveBeenCalledWith(ws, {
      botId,
      conversationId,
      channel: 'facebook',
      items: ORDER_INPUT.items,
      recipient: ORDER_INPUT.recipient,
      shippingFeeVnd: 30_000,
    });
    expect(ctx.state.stored).toBe(true);
  });

  it('collects the summary when there is no sink (playground)', async () => {
    const ctx = context(fakeCommerce());
    await runnable(ctx, PREPARE_ORDER_TOOL).run(ORDER_INPUT);
    expect(ctx.output.sent).toHaveLength(1);
    expect(ctx.output.sent[0]?.quickReplies).toHaveLength(2);
  });

  it('returns problems without sending anything', async () => {
    const problems = [{ code: 'insufficient_stock' as const, sku: 'TOY-1', available: 1 }];
    const sink = recordingSink();
    const ctx = context(fakeCommerce({ prepare: { ok: false, problems } }), { sink });
    const out = await runnable(ctx, PREPARE_ORDER_TOOL).run(ORDER_INPUT);
    expect(out.ok).toBe(false);
    expect(JSON.parse(out.content)).toEqual({ ok: false, problems });
    expect(sink.sent).toEqual([]);
    expect(ctx.output.sent).toEqual([]);
    expect(ctx.state.stored).toBe(false);
  });

  it('drops the draft when the summary was not delivered', async () => {
    const facade = fakeCommerce();
    const ctx = context(facade, { sink: recordingSink(0) });
    const out = await runnable(ctx, PREPARE_ORDER_TOOL).run(ORDER_INPUT);
    expect(JSON.parse(out.content)).toEqual({ ok: false, error: 'not_delivered' });
    expect(facade.cancelBotOrderDraft).toHaveBeenCalledWith(ws, conversationId);
    expect(ctx.output.sent).toEqual([]);
  });

  it('rejects a price or bad quantity in the arguments by schema', () => {
    const tool = runnable(context(fakeCommerce()), PREPARE_ORDER_TOOL);
    expect(tool.schema.safeParse({ ...ORDER_INPUT, items: [{ sku: 'A', qty: 100 }] }).success).toBe(
      false,
    );
    expect(tool.schema.safeParse({ ...ORDER_INPUT, items: [] }).success).toBe(false);
    const parsed = tool.schema.safeParse({
      ...ORDER_INPUT,
      items: [{ sku: 'A', qty: 1, price: 1 }],
    });
    expect(parsed.success && JSON.stringify(parsed.data)).not.toContain('price');
  });

  it('confirm takes the stored draft and ignores the model arguments', async () => {
    const facade = fakeCommerce({ storedAt: new Date(Date.now() - 60_000) });
    const ctx = context(facade, { confirmable: true });
    const tool = runnable(ctx, CONFIRM_ORDER_TOOL);
    const input = tool.schema.parse({ orderCode: 'HACK', items: [{ sku: 'X', qty: 99 }] });
    const out = await tool.run(input);
    expect(JSON.parse(out.content)).toEqual({ ok: true, orderCode: 'DH0042' });
    expect(facade.confirmBotOrder).toHaveBeenCalledWith(ws, {
      botId,
      botName: 'Rapiz Bot',
      conversationId,
    });
  });

  it('confirm refuses a draft stored in the same turn', async () => {
    const facade = fakeCommerce({ storedAt: new Date(Date.now() - 60_000) });
    const ctx = context(facade, { confirmable: true });
    await runnable(ctx, PREPARE_ORDER_TOOL).run(ORDER_INPUT);
    const out = await runnable(ctx, CONFIRM_ORDER_TOOL).run({});
    expect(JSON.parse(out.content)).toEqual({ ok: false, code: 'not_confirmable' });
    expect(facade.confirmBotOrder).not.toHaveBeenCalled();
  });

  it('confirm reports a failed confirmation code', async () => {
    const facade = fakeCommerce({ storedAt: new Date(Date.now() - 60_000) });
    vi.mocked(facade.confirmBotOrder).mockResolvedValueOnce({ ok: false, code: 'expired' });
    const out = await runnable(context(facade, { confirmable: true }), CONFIRM_ORDER_TOOL).run({});
    expect(out.ok).toBe(false);
    expect(JSON.parse(out.content)).toEqual({ ok: false, code: 'expired' });
  });

  it('cancel drops the waiting draft', async () => {
    const facade = fakeCommerce({ storedAt: new Date(Date.now() - 60_000) });
    const ctx = context(facade, { confirmable: true });
    expect(JSON.parse((await runnable(ctx, CANCEL_ORDER_DRAFT_TOOL).run({})).content)).toEqual({
      ok: true,
      status: 'cancelled',
    });
    expect(JSON.parse((await runnable(ctx, CANCEL_ORDER_DRAFT_TOOL).run({})).content)).toEqual({
      ok: false,
      code: 'nothing_pending',
    });
  });

  it('only a draft stored before the turn started is confirmable', async () => {
    const start = new Date();
    const at = (ms: number) => fakeCommerce({ storedAt: new Date(start.getTime() + ms) });
    expect(await confirmableDraft(at(-1_000), ws, conversationId, start)).toBe(true);
    expect(await confirmableDraft(at(1_000), ws, conversationId, start)).toBe(false);
    expect(await confirmableDraft(fakeCommerce(), ws, conversationId, start)).toBe(false);
  });
});

describe('order tools in the reply pipeline', () => {
  const bot = {
    id: botId,
    name: 'Rapiz Bot',
    isActive: true,
    mission: '',
    greeting: '',
    selfPronoun: 'em',
    customerPronoun: 'anh/chị',
    fallbackMessage: 'fallback',
    handoffMessage: 'handoff',
    creativity: 'balanced',
    modelTier: 'smart',
    language: 'vi',
    placeholders: {},
    industry: 'retail',
    catalogMode: 'all',
    profile: { fields: {}, notes: '' },
    orderTaking: true,
    orderShippingFeeVnd: null,
  } as unknown as BotView;

  function build(
    botView: BotView,
    script: Partial<GenerateResponse>[],
    commerce: CommerceFacade = fakeCommerce(),
  ) {
    const queue = [...script];
    const requests: GenerateRequest[] = [];
    const fake = new FakeLlmProvider('dev-fake', (req) => {
      requests.push(req);
      return queue.length > 1 ? (queue.shift() ?? { text: '' }) : (queue[0] ?? { text: '' });
    });
    const factory: LlmProviderFactory = {
      create: () => fake as LlmProvider,
      hermesLogin: () => {
        throw new Error('unused');
      },
      listModels: () => Promise.resolve({ models: [], state: 'unavailable' }),
      developmentFallback: () => ({ provider: fake, model: 'echo' }),
    };
    const svc = new PlaygroundService(
      { getBot: async () => botView } as BotFacade,
      { searchFaqs: async () => [] } as unknown as KnowledgeFacade,
      { getById: async () => ({ name: 'Shop' }) } as unknown as WorkspaceFacade,
      new LlmRuntime(new InMemoryLlmConfigRepository(), factory),
      new InMemoryAiRunRepository(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      commerce,
    );
    return { svc, requests, commerce };
  }
  const ask = (text: string) => ({ messages: [{ role: 'customer' as const, content: text }] });
  const toolNames = (req: GenerateRequest | undefined) => req?.tools?.map((t) => t.name) ?? [];
  const prepareCall: Partial<GenerateResponse> = {
    text: '',
    stopReason: 'tool_use',
    toolCalls: [{ id: 'p1', name: PREPARE_ORDER_TOOL, input: ORDER_INPUT }],
  };

  it('offers no order tools when order taking is off', async () => {
    const { svc, requests } = build({ ...bot, orderTaking: false }, [{ text: 'Dạ' }]);
    await svc.playground(ws, botId, ask('chốt đơn'));
    expect(toolNames(requests[0])).not.toContain(PREPARE_ORDER_TOOL);
  });

  it('offers no order tools for a public comment reply', async () => {
    const { svc, requests } = build(bot, [{ text: 'Dạ' }]);
    await svc.reply(ws, botId, ask('chốt đơn'), { conversationId: null, isTest: false });
    expect(toolNames(requests[0])).not.toContain(PREPARE_ORDER_TOOL);
  });

  it('shows the summary with its quick replies in the playground and offers confirm on the next turn', async () => {
    const { svc, requests, commerce } = build(bot, [prepareCall, { text: '' }, { text: 'Dạ' }]);
    const first = await svc.playground(ws, botId, ask('lấy 2 thú gỗ, Lan 0912345678, 12 LTK'));
    expect(toolNames(requests[0])).toContain(PREPARE_ORDER_TOOL);
    expect(toolNames(requests[0])).not.toContain(CONFIRM_ORDER_TOOL);
    expect(first.outcome).toBe('answered');
    expect(first.messages).toEqual([
      { text: SUMMARY, images: [], quickReplies: [...ORDER_QUICK_REPLIES], via: 'send_message' },
    ]);
    // An empty final answer after the summary needs no gateway retry.
    expect(requests[1]?.allowEmpty).toBe(true);
    expect(commerce.prepareBotOrder).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        conversationId: playgroundConversationId(botId),
        channel: 'other',
      }),
    );

    (commerce as unknown as { draft: { storedAt: Date } }).draft = {
      storedAt: new Date(Date.now() - 1_000),
    };
    requests.length = 0;
    await svc.playground(ws, botId, ask('✅ Đặt hàng'));
    expect(toolNames(requests[0])).toEqual(
      expect.arrayContaining([CONFIRM_ORDER_TOOL, CANCEL_ORDER_DRAFT_TOOL]),
    );
  });

  it('uses the conversation channel as the order source', async () => {
    const { svc, commerce } = build(bot, [prepareCall, { text: '' }]);
    const sink = recordingSink();
    await svc.reply(ws, botId, ask('chốt'), {
      conversationId,
      isTest: false,
      channel: 'instagram',
      sink,
    });
    expect(commerce.prepareBotOrder).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({ conversationId, channel: 'instagram' }),
    );
    expect(sink.sent).toHaveLength(1);
  });
});

describe('prompts 15 and 16', () => {
  it('prompt 15 tells the model to calculate and to close orders with prepare_order', async () => {
    const p15 = await readFile(`${PROMPTS_DIR}/sales-agent@15.md`, 'utf8');
    expect(p15).toContain('calculate');
    expect(p15).toContain('prepare_order');
    expect(p15).toContain('confirm_order');
    expect(p15).toContain('Never call handoff merely because an order is ready');
    expect(p15).not.toContain('Lodging facts and decisions');
  });

  it('prompt 16 is prompt 15 plus the lodging section of prompt 14, verbatim', async () => {
    const p14 = await readFile(`${PROMPTS_DIR}/sales-agent@14.md`, 'utf8');
    const p15 = await readFile(`${PROMPTS_DIR}/sales-agent@15.md`, 'utf8');
    const p16 = await readFile(`${PROMPTS_DIR}/sales-agent@16.md`, 'utf8');
    const section = (p: string) => {
      const start = p.indexOf('Lodging facts and decisions:');
      return { start, end: p.indexOf('\n\n', start) + 2 };
    };
    const s14 = section(p14);
    const s16 = section(p16);
    expect(s16.start).toBeGreaterThan(-1);
    expect(p16.slice(s16.start, s16.end)).toBe(p14.slice(s14.start, s14.end));
    expect(p16.slice(0, s16.start) + p16.slice(s16.end)).toBe(p15);
  });
});
