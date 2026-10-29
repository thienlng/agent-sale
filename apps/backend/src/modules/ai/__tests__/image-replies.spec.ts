import { FakeLlmProvider, type GenerateRequest, type LlmProvider } from '@agent-sales/ai-core';
import type { PlaygroundRequest, ProductDto, TrainingItemDto } from '@agent-sales/contracts';
import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { CatalogFacade } from '../../commerce/api/index.js';
import type { KnowledgeFacade, TrainingFacade } from '../../knowledge/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
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
  profile: { fields: {}, notes: '' },
} as unknown as BotView;

const product = (id: string, name: string, imageUrls: string[]): ProductDto =>
  ({
    id,
    code: id,
    name,
    description: '',
    botInstructions: '',
    imageUrls,
    variants: [],
  }) as unknown as ProductDto;

const oxford = product('oxford', 'Giày da Oxford', [
  'https://img.example.com/ox1.jpg',
  'https://img.example.com/ox2.jpg',
  'https://img.example.com/ox3.jpg',
  'https://img.example.com/ox4.jpg',
]);
const media = {
  id: 'size',
  kind: 'media',
  title: 'Bảng size giày',
  trigger: '',
  content: 'Bảng size',
  mediaUrl: 'https://img.example.com/size.png',
} as unknown as TrainingItemDto;

function build(reply: object | string, products: ProductDto[] = [oxford], queries: string[] = []) {
  const fake = new FakeLlmProvider('dev-fake', () => ({
    text: typeof reply === 'string' ? reply : JSON.stringify(reply),
  }));
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
    { list: async () => [media] } as unknown as TrainingFacade,
    {
      getBotProducts: async (_ws: unknown, query: string) => {
        queries.push(query);
        return products;
      },
      listBotCatalog: async () => products,
    } as unknown as CatalogFacade,
  );
  const ask = (text: string) =>
    svc.reply(
      ws,
      botId,
      { messages: [{ role: 'customer', content: text }] },
      {
        conversationId: newId(),
        isTest: false,
      },
    );
  const askWith = (messages: PlaygroundRequest['messages']) =>
    svc.reply(ws, botId, { messages }, { conversationId: newId(), isTest: false });
  return { fake, ask, askWith };
}

const answer = (imageIds?: string[]) => ({
  outcome: 'answer',
  reply: 'Dạ đây là hình ạ.',
  sources: [],
  ...(imageIds ? { imageIds } : {}),
});

describe('bot-sent images', () => {
  it('resolves valid ids to stored URLs and shows the model ids and labels only', async () => {
    const { fake, ask } = build(answer(['p:oxford:1', 'm:size']));
    const res = await ask('cho xem ảnh giày Oxford và bảng size giày');
    expect(res.images).toEqual([
      { url: 'https://img.example.com/ox2.jpg', label: 'Giày da Oxford (2/4)' },
      { url: 'https://img.example.com/size.png', label: 'Bảng size giày' },
    ]);
    const sent = JSON.stringify((fake.calls[0] as GenerateRequest).messages);
    expect(sent).toContain('Images you may send (id: label)');
    expect(sent).toContain('p:oxford:0: Giày da Oxford (1/4)');
    expect(sent).toContain('m:size: Bảng size giày');
    expect(sent).not.toContain('img.example.com');
  });

  it('tells the model what to say when a known product has no picture', async () => {
    const { fake, ask } = build(answer());
    await ask('cho xem ảnh giày da Oxford');
    const sent = JSON.stringify((fake.calls[0] as GenerateRequest).messages);
    expect(sent).toContain('no picture yet');
  });
  it('drops an invented or foreign id', async () => {
    const { ask } = build(answer(['p:other:0', 'm:nope', 'p:oxford:0']));
    expect((await ask('cho xem ảnh giày')).images).toEqual([
      { url: 'https://img.example.com/ox1.jpg', label: 'Giày da Oxford (1/4)' },
    ]);
  });

  it('ignores URL-looking strings', async () => {
    const { ask } = build(
      answer(['https://img.example.com/ox1.jpg', 'https://evil.example/x.png']),
    );
    expect((await ask('cho xem ảnh giày')).images).toEqual([]);
  });

  it('caps the pictures at 3 and dedupes', async () => {
    const { ask } = build(
      answer(['p:oxford:0', 'p:oxford:0', 'p:oxford:1', 'p:oxford:2', 'p:oxford:3']),
    );
    expect((await ask('cho xem ảnh giày')).images).toHaveLength(3);
  });

  it('returns no pictures when the model sends none or omits the field', async () => {
    expect((await build(answer([])).ask('giá giày bao nhiêu')).images).toEqual([]);
    expect((await build(answer()).ask('giá giày bao nhiêu')).images).toEqual([]);
  });

  it('sends no pictures with a fallback or handoff outcome', async () => {
    const handoff = { outcome: 'handoff', reply: '', sources: [], imageIds: ['p:oxford:0'] };
    expect((await build(handoff).ask('gặp nhân viên')).images).toEqual([]);
    const unknown = { outcome: 'unknown', reply: '', sources: [], imageIds: ['p:oxford:0'] };
    expect((await build(unknown).ask('xem ảnh')).images).toEqual([]);
  });

  it('has no allowlist block when nothing can be sent', async () => {
    const { fake, ask } = build(answer(), [product('plain', 'Dép', [])]);
    await ask('giá dép');
    expect(JSON.stringify((fake.calls[0] as GenerateRequest).messages)).not.toContain(
      'Images you may send (id: label)',
    );
  });
});

describe('product lookup keeps the product being discussed', () => {
  it('adds the last bot reply to the catalog search, so "size 41?" still finds the product', async () => {
    const queries: string[] = [];
    const { askWith } = build(answer(), [oxford], queries);
    await askWith([
      { role: 'customer', content: 'cho xem ảnh giày da Oxford' },
      { role: 'bot', content: 'Dạ em gửi ảnh giày da nam Oxford ạ.' },
      { role: 'customer', content: 'size 41 thì sao, giá bao nhiêu?' },
    ]);
    const query = queries.at(-1) ?? '';
    expect(query.startsWith('cho xem ảnh giày da Oxford\nsize 41')).toBe(true);
    expect(query).toContain('giày da nam Oxford');
  });
  it('searches with the customer text alone before the bot has said anything', async () => {
    const queries: string[] = [];
    const { ask } = build(answer(), [oxford], queries);
    await ask('giá giày Oxford bao nhiêu?');
    expect(queries.at(-1)).toBe('giá giày Oxford bao nhiêu?');
  });
});

describe('answers that are not JSON', () => {
  it('accepts a short plain-prose answer after the retry', async () => {
    const { ask } = build('Dạ, cửa hàng có giày da nam Oxford và giày lười Loafer ạ.');
    const res = await ask('shop có những mẫu nào vậy?');
    expect(res.outcome).toBe('answered');
    expect(res.reply).toBe('Dạ, cửa hàng có giày da nam Oxford và giày lười Loafer ạ.');
  });
  it('falls back when the prose is broken JSON', async () => {
    const { ask } = build('{"outcome": "answer", "reply": ');
    const res = await ask('shop có những mẫu nào vậy?');
    expect(res.outcome).toBe('fallback');
    expect(res.guardrail).toMatch(/^invalid_output/);
  });
  it('lists every product on sale as a catalog overview in the model request', async () => {
    const { fake, ask } = build(answer());
    await ask('shop có những mẫu nào vậy?');
    const sent = JSON.stringify((fake.calls[0] as GenerateRequest).messages);
    expect(sent).toContain('catalog_overview');
    expect(sent).toContain(oxford.name);
  });
});
