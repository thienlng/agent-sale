import {
  type ChatMessage,
  FakeLlmProvider,
  type GenerateRequest,
  type GenerateResponse,
} from '@agent-sales/ai-core';
import type { PlaygroundRequest, ProductDto } from '@agent-sales/contracts';
import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { CatalogFacade } from '../../commerce/api/index.js';
import type { KnowledgeFacade } from '../../knowledge/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import type { MessageSink, ReplyOptions } from '../api/reply-options.js';
import { playgroundConversationId } from '../application/action-tools.js';
import type { LlmRuntime } from '../application/llm-runtime.js';
import { PlaygroundService } from '../application/playground.service.js';
import { InMemoryAiRunRepository } from '../infrastructure/persistence/ai-run.repositories.js';
import { InMemoryConversationSummaryRepository } from '../infrastructure/persistence/conversation-summary.drizzle.js';

const ws = workspaceId(newId());
const botId = newId();
const bot = {
  id: botId,
  name: 'Bot',
  isActive: true,
  mission: '',
  greeting: '',
  selfPronoun: 'em',
  customerPronoun: 'anh/chị',
  fallbackMessage: 'fallback',
  handoffMessage: 'Dạ em chuyển nhân viên ạ.',
  creativity: 'balanced',
  modelTier: 'smart',
  language: 'vi',
  placeholders: {},
  industry: 'retail',
  catalogMode: 'all',
  profile: { fields: {}, notes: '' },
  replyLength: 'short',
  tone: 'friendly',
  allowEmoji: false,
} as unknown as BotView;

const product = (id: string, urls: string[]): ProductDto =>
  ({
    id,
    code: id,
    name: `Sản phẩm ${id}`,
    description: '',
    botInstructions: '',
    category: null,
    status: 'active',
    visibleToBot: true,
    imageUrls: urls,
    priceMin: 100000,
    priceMax: 100000,
    available: 1,
    variants: [
      {
        id: `${id}-v`,
        sku: id,
        name: 'M',
        price: 100000,
        stock: [{ available: 1, onHand: 1, reserved: 0, warehouseId: 'w' }],
      },
    ],
  }) as unknown as ProductDto;

const pool = [
  product('a', ['https://img.example.com/a0.jpg', 'https://img.example.com/a1.jpg']),
  product('b', ['https://img.example.com/b0.jpg']),
];

type Step =
  Partial<GenerateResponse> | Error | ((req: GenerateRequest) => Partial<GenerateResponse>);

const calls = (...list: { name: string; input: object }[]): Partial<GenerateResponse> => ({
  text: '',
  stopReason: 'tool_use',
  toolCalls: list.map((c, i) => ({ id: `t${i}-${c.name}`, name: c.name, input: c.input })),
});
const sendMessage = (input: object) => ({ name: 'send_message', input });
const details = (ids: string[]) => ({ name: 'product_details', input: { ids } });

function build(script: Step[], opts: { summaries?: InMemoryConversationSummaryRepository } = {}) {
  const queue = [...script];
  const fake = new FakeLlmProvider('dev-fake', (req) => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next === undefined) return new Error('script exhausted');
    return typeof next === 'function' ? next(req) : next;
  });
  const llm = {
    generate: (req: GenerateRequest) => fake.generate(req, { model: 'echo' }),
  } as unknown as LlmRuntime;
  const catalog = {
    searchBotCatalog: vi.fn(async () => pool),
    countBotCatalog: vi.fn(async () => pool.length),
    getBotProductsByIds: vi.fn(async (_w: unknown, _s: unknown, ids: readonly string[]) =>
      pool.filter((p) => ids.includes(p.id)),
    ),
  };
  const runs = new InMemoryAiRunRepository();
  const svc = new PlaygroundService(
    { getBot: async () => bot } as BotFacade,
    { searchFaqs: async () => [] } as unknown as KnowledgeFacade,
    { getById: async () => ({ name: 'Shop' }) } as unknown as WorkspaceFacade,
    llm,
    runs,
    undefined,
    catalog as unknown as CatalogFacade,
    undefined,
    undefined,
    opts.summaries,
  );
  return { fake, svc, runs, catalog };
}

const ask = (text: string): PlaygroundRequest => ({
  messages: [{ role: 'customer', content: text }],
});

const recordingSink = (delivered = 1) => {
  const sent: Parameters<MessageSink['send']>[0][] = [];
  const sink: MessageSink = {
    send: vi.fn(async (message) => {
      sent.push(message);
      return { delivered };
    }),
  };
  return { sink, sent };
};

describe('reply on the agent loop: send_message', () => {
  it('delivers send_message through the sink as it runs, then returns the final text', async () => {
    const { fake, svc } = build([
      calls(details(['a'])),
      calls(sendMessage({ text: 'Dạ mẫu A đây ạ', imageIds: ['p:a:0', 'p:a:1'] })),
      { text: 'Dạ mẫu A giá 100.000đ ạ.' },
    ]);
    const { sink, sent } = recordingSink(3);
    const conversationId = newId();
    const res = await svc.reply(ws, botId, ask('cho xem mẫu A'), {
      conversationId,
      isTest: false,
      sink,
    });

    expect(sent).toEqual([
      {
        text: 'Dạ mẫu A đây ạ',
        images: [
          { id: 'p:a:0', url: 'https://img.example.com/a0.jpg', label: 'Sản phẩm a (1/2)' },
          { id: 'p:a:1', url: 'https://img.example.com/a1.jpg', label: 'Sản phẩm a (2/2)' },
        ],
      },
    ]);
    expect(res.messages).toEqual([
      { text: 'Dạ mẫu A đây ạ', images: sent[0]?.images, via: 'send_message' },
      { text: 'Dạ mẫu A giá 100.000đ ạ.', images: [], via: 'final' },
    ]);
    expect(res).toMatchObject({
      outcome: 'answered',
      reply: 'Dạ mẫu A đây ạ\nDạ mẫu A giá 100.000đ ạ.',
      images: [
        { url: 'https://img.example.com/a0.jpg', label: 'Sản phẩm a (1/2)' },
        { url: 'https://img.example.com/a1.jpg', label: 'Sản phẩm a (2/2)' },
      ],
    });
    const toolResult = fake.calls[2]?.messages.at(-1);
    expect(toolResult).toMatchObject({ role: 'tool', name: 'send_message' });
    expect(JSON.parse(toolResult?.content ?? '{}')).toEqual({ status: 'sent', delivered: 3 });
    // The cache key is the bot and the conversation; no structured output on the reply path.
    for (const call of fake.calls) {
      expect(call.promptCacheKey).toBe(`${botId}:${conversationId}`);
      expect(call.responseFormat).toBeUndefined();
      expect(JSON.stringify(call.messages)).not.toContain('img.example.com');
    }
    expect(res.steps?.filter((s) => s.kind === 'tool').map((s) => s.name)).toEqual([
      'product_details',
      'send_message',
    ]);
  });

  it('collects send_message in the playground and accepts an empty final answer after it', async () => {
    const { svc } = build([calls(sendMessage({ text: 'Dạ có ạ' })), { text: '' }]);
    const res = await svc.playground(ws, botId, ask('còn hàng không'));
    expect(res).toMatchObject({
      outcome: 'answered',
      reply: 'Dạ có ạ',
      messages: [{ text: 'Dạ có ạ', images: [], via: 'send_message' }],
    });
  });

  it('does not record a message the sink did not deliver (takeover) and tells the model', async () => {
    const { fake, svc } = build([calls(sendMessage({ text: 'Dạ có ạ' })), { text: '' }]);
    const { sink } = recordingSink(0);
    const res = await svc.reply(ws, botId, ask('còn hàng không'), {
      conversationId: newId(),
      isTest: false,
      sink,
    });
    expect(fake.calls[1]?.messages.at(-1)?.content).toContain('not_delivered');
    expect(res).toMatchObject({ outcome: 'fallback', reply: 'fallback' });
  });

  it('rejects an empty send_message and a text over 2000 characters', async () => {
    const { fake, svc } = build([
      calls(sendMessage({}), sendMessage({ text: 'x'.repeat(2001) })),
      { text: 'Dạ ạ' },
    ]);
    const res = await svc.playground(ws, botId, ask('hi'));
    const results = fake.calls[1]?.messages.filter((m) => m.role === 'tool') ?? [];
    expect(results.map((m) => JSON.parse(m.content).error)).toEqual([
      'invalid_arguments',
      'invalid_arguments',
    ]);
    expect(res.messages?.map((m) => m.via)).toEqual(['final']);
  });
});

describe('reply on the agent loop: interrupt and carry', () => {
  it('stops on interrupt, returns the follow-ups as carry and sends no final message', async () => {
    const { fake, svc, runs } = build([calls(details(['b'])), { text: 'never reached' }]);
    let checks = 0;
    // The first check (before the first call) says no; the one after the batch says yes.
    const shouldInterrupt = async () => checks++ > 0;
    const res = await svc.reply(ws, botId, ask('mẫu B'), {
      conversationId: newId(),
      isTest: false,
      shouldInterrupt,
    });
    expect(res.interrupted).toBe(true);
    expect(res.outcome).toBe('fallback');
    expect(res.guardrail).toBe('interrupted');
    expect(res.messages).toEqual([]);
    expect(res.carry?.map((m) => m.role)).toEqual(['assistant', 'tool']);
    expect(fake.calls).toHaveLength(1);
    expect(res.steps?.at(-1)).toEqual({ kind: 'interrupted' });
    // Billed and remembered: the products it looked at become the re-run's focus.
    expect(runs.runs[0]).toMatchObject({ guardrail: 'interrupted', productIds: ['b'] });
  });

  it('appends the carry after the new turn and keeps its pictures sendable', async () => {
    const carry: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'old', name: 'product_details', input: { ids: ['b'] } }],
      },
      {
        role: 'tool',
        toolCallId: 'old',
        name: 'product_details',
        content: '{"products":[{"id":"b","images":[{"id":"p:b:0","label":"Sản phẩm b"}]}]}',
      },
    ];
    const { fake, svc, catalog } = build([
      calls(sendMessage({ imageIds: ['p:b:0'] })),
      { text: 'Dạ mẫu B đây ạ' },
    ]);
    const options: ReplyOptions = { conversationId: newId(), isTest: false, carry };
    const res = await svc.reply(ws, botId, ask('mẫu B có ảnh không'), options);
    expect(fake.calls[0]?.messages.slice(-2)).toEqual(carry);
    expect(catalog.getBotProductsByIds).toHaveBeenCalledWith(ws, expect.anything(), ['b']);
    expect(res.messages?.[0]?.images.map((i) => i.url)).toEqual(['https://img.example.com/b0.jpg']);
    expect(res.interrupted).toBeUndefined();
    expect(res.carry).toBeUndefined();
  });
});

describe('reply on the agent loop: context', () => {
  it('keeps the system prompt byte-identical across turns and moves the time to the last message', async () => {
    const { fake, svc } = build([{ text: 'Dạ ạ' }]);
    await svc.playground(ws, botId, ask('hi'));
    await svc.playground(ws, botId, {
      messages: [
        { role: 'customer', content: 'hi' },
        { role: 'bot', content: 'Dạ ạ' },
        { role: 'customer', content: 'còn không' },
      ],
      phoneKnown: true,
    });
    const [a, b] = fake.calls;
    expect(a?.messages[0]?.content).toBe(b?.messages[0]?.content);
    expect(a?.messages[0]?.content).not.toContain('<current_time>');
    expect(b?.messages.at(-1)?.content).toMatch(
      /<current_time>[^<]+Asia\/Ho_Chi_Minh\)<\/current_time>/,
    );
    expect(a?.promptCacheKey).toBe(`${botId}:${playgroundConversationId(botId)}`);
  });

  it('records a failed run with the usage spent so far when a later model call throws', async () => {
    const { svc, runs } = build([calls(details(['a'])), new Error('provider down')]);
    await expect(svc.playground(ws, botId, ask('mẫu A'))).rejects.toThrow('provider down');
    expect(runs.runs).toEqual([
      expect.objectContaining({
        outcome: 'fallback',
        guardrail: 'model_error',
        inputTokens: 10,
        outputTokens: 5,
      }),
    ]);
  });

  it('summarises a long history, stores the summary and reuses it on the next turn', async () => {
    const long = 'x'.repeat(1_500);
    const messages: PlaygroundRequest['messages'] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? ('customer' as const) : ('bot' as const),
      content: `${i} ${long}`,
    }));
    messages.push({ role: 'customer', content: 'số điện thoại em đưa lúc nãy là gì' });
    const times = messages.map((_, i) => new Date(Date.UTC(2026, 9, 31, 8, i)));
    const summarizer = (req: GenerateRequest) =>
      req.messages[0]?.content.includes('memory note')
        ? { text: 'Khách để lại số 0912345678.' }
        : { text: 'Dạ số 0912345678 ạ.' };
    const summaries = new InMemoryConversationSummaryRepository();
    const { fake, svc } = build([summarizer], { summaries });
    const conversationId = newId();
    const options = { conversationId, isTest: false, turnTimes: times };

    const res = await svc.reply(ws, botId, { messages }, options);
    expect(res.outcome).toBe('answered');
    const answerCall = fake.calls.find((c) => !c.messages[0]?.content.includes('memory note'));
    expect(answerCall?.messages[1]?.content).toContain('<earlier_conversation_summary>');
    // The summary and the first kept turn are merged: never two user messages in a row.
    const roles = answerCall?.messages.map((m) => m.role) ?? [];
    expect(roles.some((r, i) => r === 'user' && roles[i - 1] === 'user')).toBe(false);
    const saved = await summaries.get(ws, conversationId);
    expect(saved).toMatchObject({ summary: 'Khách để lại số 0912345678.', coveredUntil: times[8] });
    expect(res.usage.inputTokens).toBe(20);

    // Next turn: the stored summary still covers the old turns, so no new summarizer call.
    const before = fake.calls.length;
    await svc.reply(ws, botId, { messages }, options);
    expect(
      fake.calls.slice(before).some((c) => c.messages[0]?.content.includes('memory note')),
    ).toBe(false);
  });

  it('keeps the full history when the summarizer fails', async () => {
    const messages: PlaygroundRequest['messages'] = Array.from({ length: 19 }, (_, i) => ({
      role: i % 2 === 0 ? ('customer' as const) : ('bot' as const),
      content: `${i} ${'y'.repeat(1_500)}`,
    }));
    const { fake, svc } = build([
      (req) => (req.messages[0]?.content.includes('memory note') ? { text: '' } : { text: 'Dạ ạ' }),
    ]);
    const res = await svc.reply(
      ws,
      botId,
      { messages },
      { conversationId: newId(), isTest: false },
    );
    expect(res.outcome).toBe('answered');
    const answerCall = fake.calls.at(-1);
    expect(JSON.stringify(answerCall?.messages)).not.toContain('earlier_conversation_summary');
    expect(answerCall?.messages[1]?.content).toContain('0 yyy');
  });
});
