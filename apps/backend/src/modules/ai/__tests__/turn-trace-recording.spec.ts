import { createHash } from 'node:crypto';

import { FakeLlmProvider, type GenerateRequest, type GenerateResponse } from '@agent-sales/ai-core';
import type { PlaygroundRequest, ProductDto, TrainingItemDto } from '@agent-sales/contracts';
import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { CatalogFacade } from '../../commerce/api/index.js';
import type { KnowledgeFacade, TrainingFacade } from '../../knowledge/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import type { LlmRuntime } from '../application/llm-runtime.js';
import { PlaygroundService } from '../application/playground.service.js';
import { InMemoryAiRunRepository } from '../infrastructure/persistence/ai-run.repositories.js';
import { InMemoryTurnTraceRepository } from '../infrastructure/persistence/turn-trace.repositories.js';

const ws = workspaceId(newId());
const botId = newId();
const bot = {
  id: botId,
  name: 'Bot',
  isActive: true,
  mission: 'Bán áo',
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

const product = {
  id: 'a',
  code: 'a',
  name: 'Áo A',
  description: '',
  botInstructions: '',
  category: null,
  status: 'active',
  visibleToBot: true,
  imageUrls: [],
  priceMin: 0,
  priceMax: 0,
  available: 0,
  variants: [
    {
      id: 'a-v',
      sku: 'a',
      name: 'M',
      price: 0,
      stock: [{ available: 0, onHand: 0, reserved: 0, warehouseId: 'w' }],
    },
  ],
} as unknown as ProductDto;

const scenario = (title: string, enabled = true): TrainingItemDto =>
  ({
    id: newId(),
    botId,
    kind: 'scenario',
    title,
    content: 'Hỏi mã đơn.',
    trigger: null,
    enabled,
    section: 'general',
    createdAt: new Date().toISOString(),
  }) as unknown as TrainingItemDto;

type Step = Partial<GenerateResponse> | Error;
const calls = (...list: { name: string; input: object }[]): Partial<GenerateResponse> => ({
  text: '',
  stopReason: 'tool_use',
  toolCalls: list.map((c, i) => ({ id: `t${i}-${c.name}`, name: c.name, input: c.input })),
});

function build(script: Step[], opts: { traces?: 'on' | 'off' | 'throw' } = {}) {
  const queue = [...script];
  const fake = new FakeLlmProvider('dev-fake', () => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return next ?? new Error('script exhausted');
  });
  const llm = {
    generate: (req: GenerateRequest) => fake.generate(req, { model: 'echo' }),
  } as unknown as LlmRuntime;
  const catalog = {
    searchBotCatalog: vi.fn(async () => [product]),
    countBotCatalog: vi.fn(async () => 1),
    getBotProductsByIds: vi.fn(async () => [product]),
  };
  const scenarios = [scenario('Đổi trả'), scenario('Tắt', false)];
  const training = { list: async () => scenarios } as unknown as TrainingFacade;
  const runs = new InMemoryAiRunRepository();
  const traces = new InMemoryTurnTraceRepository(runs);
  if (opts.traces === 'throw') traces.failWith = new Error('db down');
  const svc = new PlaygroundService(
    { getBot: async () => bot } as BotFacade,
    { searchFaqs: async () => [] } as unknown as KnowledgeFacade,
    { getById: async () => ({ name: 'Shop' }) } as unknown as WorkspaceFacade,
    llm,
    runs,
    training,
    catalog as unknown as CatalogFacade,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    opts.traces === 'off' ? undefined : traces,
  );
  return { fake, svc, runs, traces, scenarios };
}

const ask = (text: string): PlaygroundRequest => ({
  messages: [{ role: 'customer', content: text }],
});
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe('PlaygroundService turn traces', () => {
  it('writes one trace per answered turn with what the bot saw and its steps', async () => {
    const { fake, svc, runs, traces, scenarios } = build([
      calls(
        { name: 'search_products', input: { query: 'áo gọi 0912345678' } },
        { name: 'product_details', input: { ids: ['a'] } },
      ),
      { text: 'Dạ áo A hết hàng ạ, gọi 0912345678' },
    ]);
    const res = await svc.playground(ws, botId, ask('áo A còn không? sđt 0912345678'));
    expect(res.outcome).toBe('answered');
    expect(traces.traces).toHaveLength(1);
    const { trace, steps } = traces.traces[0] ?? { trace: null, steps: [] };
    const system = String(fake.calls[0]?.messages[0]?.content);
    expect(trace).toMatchObject({
      runId: runs.runs[0]?.id,
      botId,
      commentReply: false,
      historyTurns: 1,
      historySummarized: false,
      customerImages: 0,
      queryExcerpt: 'áo A còn không? sđt [phone]',
      replyExcerpt: 'Dạ áo A hết hàng ạ, gọi [phone]',
      scenarioIds: [scenarios[0]?.id],
      pendingAction: false,
      offeredTools: ['calculate', 'handoff', 'product_details', 'search_products', 'send_message'],
      systemPromptSha: sha(system),
      modelCalls: 2,
      loopOutcome: 'done',
      messagesSent: 1,
      messagesUndelivered: 0,
    });
    expect(trace?.startedAt).toBeInstanceOf(Date);
    expect(steps.map((s) => [s.kind, s.toolName])).toEqual([
      ['model_call', null],
      ['tool', 'search_products'],
      ['tool', 'product_details'],
      ['model_call', null],
    ]);
    expect(steps[1]?.detail).toEqual({
      query: 'áo gọi [phone]',
      resultCount: 1,
      productIds: ['a'],
    });
    expect(steps[2]?.detail).toMatchObject({
      missing: [{ productId: 'a', fields: ['price', 'stock', 'description', 'images'] }],
    });
    expect(JSON.stringify(traces.traces)).not.toContain('0912345678');
  });

  it('traces a fallback turn', async () => {
    const { svc, traces } = build([{ text: '' }]);
    const res = await svc.playground(ws, botId, ask('hello'));
    expect(res.outcome).toBe('fallback');
    expect(traces.traces[0]?.trace).toMatchObject({
      loopOutcome: 'done',
      messagesSent: 1,
      replyExcerpt: 'fallback',
    });
  });

  it('traces a model error before any output, then rethrows as before', async () => {
    const { svc, runs, traces } = build([
      calls({ name: 'search_products', input: { query: 'ao' } }),
      new Error('provider down'),
    ]);
    await expect(svc.playground(ws, botId, ask('áo'))).rejects.toThrow('provider down');
    expect(runs.runs).toHaveLength(1);
    expect(traces.traces[0]?.trace).toMatchObject({
      runId: runs.runs[0]?.id,
      loopOutcome: 'error',
      replyExcerpt: null,
      messagesSent: 0,
    });
    expect(traces.traces[0]?.steps.map((s) => s.kind)).toEqual(['model_call', 'tool']);
  });

  it('traces an interrupted turn', async () => {
    const { svc, traces } = build([
      calls({ name: 'product_details', input: { ids: ['a'] } }),
      { text: 'never' },
    ]);
    let checks = 0;
    const res = await svc.reply(ws, botId, ask('áo A'), {
      conversationId: newId(),
      isTest: false,
      channel: 'facebook',
      shouldInterrupt: async () => checks++ > 0,
    });
    expect(res.interrupted).toBe(true);
    expect(traces.traces[0]?.trace).toMatchObject({
      loopOutcome: 'interrupted',
      channel: 'facebook',
      messagesSent: 0,
    });
    expect(traces.traces[0]?.steps.at(-1)?.kind).toBe('interrupted');
  });

  it('a failing trace write never changes the reply', async () => {
    const script = (): Step[] => [
      calls({ name: 'search_products', input: { query: 'ao' } }),
      { text: 'Dạ có ạ' },
    ];
    const withFailure = build(script(), { traces: 'throw' });
    const without = build(script(), { traces: 'off' });
    const a = await withFailure.svc.playground(ws, botId, ask('áo'));
    const b = await without.svc.playground(ws, botId, ask('áo'));
    const strip = (r: typeof a) => ({
      ...r,
      runId: '',
      latencyMs: 0,
      steps: r.steps?.map((step) => ({ ...step, ms: 0 })),
    });
    expect(strip(a)).toEqual(strip(b));
    expect(withFailure.runs.runs).toHaveLength(1);
    expect(withFailure.traces.traces).toEqual([]);
  });
});
