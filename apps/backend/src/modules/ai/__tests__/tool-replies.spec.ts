import {
  FakeLlmProvider,
  type GenerateRequest,
  type GenerateResponse,
  type LlmProvider,
} from '@agent-sales/ai-core';
import type { PlaygroundRequest, ProductDto } from '@agent-sales/contracts';
import { newId, workspaceId } from '@agent-sales/shared';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { CatalogFacade } from '../../commerce/api/index.js';
import type { KnowledgeFacade } from '../../knowledge/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import { playgroundConversationId } from '../application/action-tools.js';
import { LlmRuntime } from '../application/llm-runtime.js';
import { PlaygroundService } from '../application/playground.service.js';
import type { LlmProviderFactory } from '../application/ports/llm-provider-factory.js';
import { InMemoryAiRunRepository } from '../infrastructure/persistence/ai-run.repositories.js';
import { InMemoryLlmConfigRepository } from '../infrastructure/persistence/llm-config.in-memory-repository.js';

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
  handoffMessage: 'handoff',
  creativity: 'balanced',
  modelTier: 'smart',
  language: 'vi',
  placeholders: {},
  industry: 'retail',
  catalogMode: 'selected',
  profile: { fields: {}, notes: '' },
} as unknown as BotView;

const toy = {
  id: 'toy-1',
  code: 'TOY',
  name: 'Thú gỗ xếp thăng bằng',
  description: 'Bộ xếp hình gỗ cho bé từ 2 tuổi',
  botInstructions: '',
  category: 'Đồ chơi gỗ',
  status: 'active',
  visibleToBot: true,
  imageUrls: ['https://img.example.com/toy1.jpg', 'https://img.example.com/toy2.jpg'],
  priceMin: 350000,
  priceMax: 350000,
  available: 5,
  variants: [
    {
      id: 'v1',
      sku: 'TOY-1',
      name: 'Mặc định',
      price: 350000,
      stock: [{ available: 5, onHand: 5, reserved: 0, warehouseId: 'w' }],
    },
  ],
} as unknown as ProductDto;

const tool = (name: string, input: object): Partial<GenerateResponse> => ({
  text: '',
  stopReason: 'tool_use',
  toolCalls: [{ id: `c-${name}`, name, input }],
});
const final = (reply: string) => ({ text: reply });
const send = (imageIds: string[], text?: string): Partial<GenerateResponse> => ({
  text: '',
  stopReason: 'tool_use',
  toolCalls: [
    { id: 'c-send', name: 'send_message', input: { imageIds, ...(text ? { text } : {}) } },
  ],
});

function build(
  script: (Partial<GenerateResponse> | ((req: GenerateRequest) => Partial<GenerateResponse>))[],
  catalogError?: Error,
  pool: ProductDto[] = [toy],
) {
  const queue = [...script];
  const fake = new FakeLlmProvider('dev-fake', (req) => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return typeof next === 'function' ? next(req) : (next ?? new Error('script exhausted'));
  });
  const factory: LlmProviderFactory = {
    create: () => fake as LlmProvider,
    hermesLogin: () => {
      throw new Error('unused');
    },
    listModels: () => Promise.resolve({ models: [], state: 'unavailable' }),
    developmentFallback: () => ({ provider: fake, model: 'echo' }),
  };
  const catalog = {
    searchBotCatalog: vi.fn(async () => {
      if (catalogError) throw catalogError;
      return pool.slice(0, 3);
    }),
    countBotCatalog: vi.fn(async () => 1),
    getBotProductsByIds: vi.fn(async (_w: unknown, _s: unknown, ids: readonly string[]) =>
      pool.filter((p) => ids.includes(p.id)),
    ),
  };
  const runs = new InMemoryAiRunRepository();
  const svc = new PlaygroundService(
    { getBot: async () => bot } as BotFacade,
    { searchFaqs: async () => [] } as unknown as KnowledgeFacade,
    { getById: async () => ({ name: 'Shop' }) } as unknown as WorkspaceFacade,
    new LlmRuntime(new InMemoryLlmConfigRepository(), factory),
    runs,
    undefined,
    catalog as unknown as CatalogFacade,
  );
  return { fake, catalog, runs, svc };
}

const ask = (text: string): PlaygroundRequest => ({
  messages: [{ role: 'customer', content: text }],
});
/** Everything after the system prompt (which names the blocks it explains). */
const body = (req: GenerateRequest | undefined) => JSON.stringify(req?.messages.slice(1));

afterEach(() => vi.restoreAllMocks());

describe('the reply pipeline answers from catalog tools', () => {
  it('searches, feeds the result back, sends a picture and answers in free text', async () => {
    const { fake, catalog, runs, svc } = build([
      tool('search_products', { query: 'thu go' }),
      send(['p:toy-1:1']),
      final('Dạ bộ thú gỗ giá 350.000đ ạ.'),
    ]);
    const res = await svc.playground(ws, botId, ask('có đồ chơi gỗ cho bé 2 tuổi không'));

    expect(res.outcome).toBe('answered');
    expect(res.reply).toContain('350.000đ');
    expect(res.images).toEqual([
      { url: 'https://img.example.com/toy2.jpg', label: 'Thú gỗ xếp thăng bằng (2/2)' },
    ]);
    // The server supplies workspace and scope; the model only chooses the keywords.
    expect(catalog.searchBotCatalog).toHaveBeenCalledWith(
      ws,
      { botId, catalogMode: 'selected' },
      { query: 'thu go', limit: 8 },
    );
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[0]?.tools?.map((t) => t.name)).toEqual([
      'search_products',
      'product_details',
      'send_message',
      'handoff',
    ]);
    const second = fake.calls[1]?.messages ?? [];
    expect(second.at(-2)).toMatchObject({
      role: 'assistant',
      toolCalls: [{ name: 'search_products' }],
    });
    expect(second.at(-1)).toMatchObject({ role: 'tool', name: 'search_products' });
    expect(second.at(-1)?.content).toContain('350000');
    for (const call of fake.calls) {
      expect(body(call)).not.toContain('<catalog');
      expect(JSON.stringify(call)).not.toContain('img.example.com');
    }
    expect(runs.runs[0]).toMatchObject({
      productIds: ['toy-1'],
      conversationId: playgroundConversationId(botId),
      promptVersion: 'sales-agent@13',
      isTest: true,
    });
    expect(res.usage).toEqual({ inputTokens: 30, outputTokens: 15, cachedInputTokens: 0 });
    expect(res.steps?.map((s) => `${s.kind}:${s.name ?? ''}`)).toEqual([
      'model_call:',
      'tool:search_products',
      'model_call:',
      'tool:send_message',
      'model_call:',
    ]);
  });

  it('answers a follow-up from the focus products without a tool call', async () => {
    const { fake, catalog, svc } = build([
      tool('search_products', { query: 'thu go' }),
      final('Dạ ạ.'),
      final('Dạ bộ đó vẫn giá 350.000đ ạ.'),
    ]);
    await svc.playground(ws, botId, ask('có đồ chơi gỗ không'));
    catalog.getBotProductsByIds.mockClear();
    const res = await svc.playground(ws, botId, {
      messages: [
        { role: 'customer', content: 'có đồ chơi gỗ không' },
        { role: 'bot', content: 'Dạ ạ.' },
        { role: 'customer', content: 'giá bao nhiêu vậy' },
      ],
    });
    expect(res).toMatchObject({ outcome: 'answered', reply: 'Dạ bộ đó vẫn giá 350.000đ ạ.' });
    expect(fake.calls).toHaveLength(3);
    const user = String(fake.calls[2]?.messages.at(-1)?.content);
    expect(user).toContain('<focus_products>');
    expect(user).toContain('Thú gỗ xếp thăng bằng');
    expect(user.indexOf('<shop_situations>')).toBeLessThan(user.indexOf('<focus_products>'));
    expect(user.indexOf('<focus_products>')).toBeLessThan(user.indexOf('<customer>'));
    expect(catalog.getBotProductsByIds).toHaveBeenCalledWith(
      ws,
      { botId, catalogMode: 'selected' },
      ['toy-1'],
    );
  });

  it('forgets playground focus products after 30 minutes, not a real conversation', async () => {
    const { fake, runs, svc } = build([final('Dạ ạ.')]);
    const old = new Date(Date.now() - 31 * 60_000);
    const conversationId = newId();
    const record = (id: string) =>
      runs.record(ws, {
        id: newId(),
        botId,
        conversationId: id,
        tier: 'smart',
        provider: 'p',
        model: 'm',
        promptVersion: 'sales-agent@13',
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        latencyMs: 0,
        retrieved: [],
        outcome: 'answered',
        guardrail: null,
        isTest: false,
        productIds: ['toy-1'],
        createdAt: old,
      });
    await record(playgroundConversationId(botId));
    await record(conversationId);

    await svc.playground(ws, botId, ask('giá bao nhiêu'));
    expect(body(fake.calls[0])).not.toContain('<focus_products>');
    await svc.reply(ws, botId, ask('giá bao nhiêu'), { conversationId, isTest: false });
    expect(body(fake.calls[1])).toContain('<focus_products>');
  });

  it('keeps a fanpage comment reply out of the focus memory', async () => {
    const { fake, runs, svc } = build([final('Dạ ạ.')]);
    await runs.record(ws, {
      id: newId(),
      botId,
      conversationId: playgroundConversationId(botId),
      tier: 'smart',
      provider: 'p',
      model: 'm',
      promptVersion: 'sales-agent@13',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      latencyMs: 0,
      retrieved: [],
      outcome: 'answered',
      guardrail: null,
      isTest: true,
      productIds: ['toy-1'],
      createdAt: new Date(),
    });
    await svc.reply(ws, botId, ask('giá bao nhiêu'), { conversationId: null, isTest: false });
    expect(body(fake.calls[0])).not.toContain('<focus_products>');
    expect(runs.runs.at(-1)?.conversationId).toBeNull();
  });

  it('ends in the fallback when the model keeps calling tools after the round budget', async () => {
    const { fake, svc, runs } = build([tool('search_products', { query: 'thu go' })]);
    const res = await svc.playground(ws, botId, ask('có gì không'));
    expect(res).toMatchObject({
      outcome: 'fallback',
      guardrail: 'tool_loop_limit',
      reply: 'fallback',
    });
    // 10 rounds, then one call with tools forbidden.
    expect(fake.calls).toHaveLength(11);
    expect(fake.calls[10]?.toolChoice).toBe('none');
    expect(runs.runs[0]?.guardrail).toBe('tool_loop_limit');
  });

  it('tells the model only that a tool failed, and logs the tool name and error class only', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { fake, svc } = build(
      [tool('search_products', { query: 'chuyện riêng' }), final('Dạ em chưa tra được ạ.')],
      new Error('relation failed, params: chuyện riêng 0912345678'),
    );
    const res = await svc.playground(ws, botId, ask('số điện thoại 0912345678 của tôi'));
    expect(res.outcome).toBe('answered');
    expect(fake.calls[1]?.messages.at(-1)?.content).toBe('{"error":"tool_failed"}');
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('search_products');
    expect(logged).toContain('Error');
    expect(logged).not.toContain('relation failed');
    expect(logged).not.toContain('chuyện riêng');
    expect(logged).not.toContain('0912345678');
  });

  it('never fetches tool-result products again: their pictures come with the tool rows', async () => {
    const { catalog, svc } = build([tool('search_products', { query: 'thu go' }), final('Dạ ạ.')]);
    await svc.playground(ws, botId, ask('thú gỗ'));
    expect(catalog.getBotProductsByIds).not.toHaveBeenCalled();
  });

  it('keeps the pictures of the first of seven detailed products selectable', async () => {
    const pool = Array.from({ length: 7 }, (_, i) => ({
      ...toy,
      id: `toy-${i + 1}`,
      imageUrls: [`https://img.example.com/t${i + 1}.jpg`],
    })) as unknown as ProductDto[];
    const { svc } = build(
      [
        tool('search_products', { query: 'thu go' }),
        tool('product_details', { ids: ['toy-4', 'toy-5', 'toy-6'] }),
        tool('product_details', { ids: ['toy-7'] }),
        send(['p:toy-1:0', 'p:toy-7:0']),
        final('Dạ bộ thú gỗ giá 350.000đ ạ.'),
      ],
      undefined,
      pool,
    );
    const res = await svc.playground(ws, botId, ask('thú gỗ'));
    expect(res.images.map((i) => i.url)).toEqual([
      'https://img.example.com/t1.jpg',
      'https://img.example.com/t7.jpg',
    ]);
  });

  it('declares only the output tools for a bot without a catalog or actions', async () => {
    const fake = new FakeLlmProvider('dev-fake', () => final('Dạ ạ.'));
    const factory: LlmProviderFactory = {
      create: () => fake as LlmProvider,
      hermesLogin: () => {
        throw new Error('unused');
      },
      listModels: () => Promise.resolve({ models: [], state: 'unavailable' }),
      developmentFallback: () => ({ provider: fake, model: 'echo' }),
    };
    const svc = new PlaygroundService(
      { getBot: async () => bot } as BotFacade,
      { searchFaqs: async () => [] } as unknown as KnowledgeFacade,
      { getById: async () => ({ name: 'Shop' }) } as unknown as WorkspaceFacade,
      new LlmRuntime(new InMemoryLlmConfigRepository(), factory),
      new InMemoryAiRunRepository(),
    );
    await svc.playground(ws, botId, ask('chào'));
    expect(fake.calls[0]?.tools?.map((t) => t.name)).toEqual(['send_message', 'handoff']);
    expect(fake.calls[0]?.toolChoice).toBeUndefined();
  });
});
