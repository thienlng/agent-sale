import {
  FakeLlmProvider,
  type GenerateRequest,
  type GenerateResponse,
  type LlmProvider,
  type ToolCall,
} from '@agent-sales/ai-core';
import type { PlaygroundRequest, ProductDto } from '@agent-sales/contracts';
import { formatVnd, newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { CatalogFacade } from '../../commerce/api/index.js';
import type { KnowledgeFacade, TrainingFacade } from '../../knowledge/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import { LlmRuntime } from '../application/llm-runtime.js';
import { PlaygroundService } from '../application/playground.service.js';
import type { LlmProviderFactory } from '../application/ports/llm-provider-factory.js';
import { cardPrice } from '../application/website-tools.js';
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

const product = (
  id: string,
  name: string,
  price: [number, number],
  imageUrls: string[] = [],
  offering?: { kind: string; priceNote: string },
): ProductDto =>
  ({
    id,
    code: id,
    name,
    description: '',
    botInstructions: '',
    imageUrls,
    priceMin: price[0],
    priceMax: price[1],
    variants: [],
    ...(offering ? { offering } : {}),
  }) as unknown as ProductDto;

const basic = product('basic', 'Gói Basic', [200_000, 200_000], ['https://img.example.com/b.jpg']);
const pro = product('pro', 'Gói Pro', [400_000, 900_000]);

const page: NonNullable<PlaygroundRequest['pageContext']> = {
  url: 'https://shop.vn/san-pham?ref=mail',
  title: 'Sản phẩm',
  sections: [],
  nav: [
    { label: 'Bảng giá', url: 'https://shop.vn/san-pham#pricing' },
    { label: 'Liên hệ', url: '/lien-he?utm=1' },
  ],
};

const call = (name: string, input: unknown, id = 't1'): Partial<GenerateResponse> => ({
  text: '',
  stopReason: 'tool_use',
  toolCalls: [{ id, name, input } as ToolCall],
});
const search = call('search_products', { query: 'gói' }, 'c1');

/** A scripted turn: each step once, then the last one again. */
function build(script: Partial<GenerateResponse>[], products: ProductDto[] = [basic, pro]) {
  const steps = [...script];
  const fake = new FakeLlmProvider('dev-fake', () =>
    steps.length > 1 ? (steps.shift() ?? {}) : (steps[0] ?? {}),
  );
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
    { list: async () => [] } as unknown as TrainingFacade,
    {
      searchBotCatalog: async () => products,
      countBotCatalog: async () => products.length,
      getBotProductsByIds: async (_ws: unknown, _bot: unknown, ids: readonly string[]) =>
        products.filter((p) => ids.includes(p.id)),
    } as unknown as CatalogFacade,
  );
  const ask = (text: string, pageContext: PlaygroundRequest['pageContext'] | null = page) =>
    svc.reply(
      ws,
      botId,
      { messages: [{ role: 'customer', content: text }], ...(pageContext ? { pageContext } : {}) },
      { conversationId: newId(), isTest: false },
    );
  return { fake, ask };
}

const toolNames = (req: GenerateRequest | undefined) => (req?.tools ?? []).map((t) => t.name);
const toolResult = (req: GenerateRequest | undefined, id = 't1') =>
  String(req?.messages.find((m) => m.role === 'tool' && m.toolCallId === id)?.content);

describe('website rich messages', () => {
  it('offers the website tools on website turns only', async () => {
    const site = build([{ text: 'Dạ ạ.' }]);
    await site.ask('chào shop');
    expect(toolNames(site.fake.calls[0])).toEqual(
      expect.arrayContaining(['show_products', 'suggest_next']),
    );

    const other = build([{ text: 'Dạ ạ.' }]);
    await other.ask('chào shop', null);
    expect(toolNames(other.fake.calls[0])).not.toContain('show_products');
    expect(toolNames(other.fake.calls[0])).not.toContain('suggest_next');
  });

  it('sends product cards built from catalog data, never from the model', async () => {
    const { fake, ask } = build([
      search,
      call('show_products', { text: 'Dạ shop có 2 gói ạ', productIds: ['basic', 'pro', 'ghost'] }),
      { text: 'Anh/chị muốn tìm hiểu gói nào ạ?' },
    ]);
    const res = await ask('có những gói nào');
    expect(res.messages?.[0]).toEqual({
      text: 'Dạ shop có 2 gói ạ',
      images: [],
      ui: {
        cards: [
          {
            productId: 'basic',
            title: 'Gói Basic',
            price: formatVnd(200_000),
            imageUrl: 'https://img.example.com/b.jpg',
          },
          { productId: 'pro', title: 'Gói Pro', price: `Từ ${formatVnd(400_000)}`, imageUrl: null },
        ],
      },
      via: 'send_message',
    });
    expect(res.messages?.[1]?.text).toBe('Anh/chị muốn tìm hiểu gói nào ạ?');
    const result = JSON.parse(toolResult(fake.calls[2])) as Record<string, unknown>;
    expect(result.status).toBe('sent');
    expect(result.unknownProductIds).toEqual(['ghost']);
  });

  it('refuses cards for products the turn has not seen', async () => {
    const { fake, ask } = build([
      call('show_products', { text: 'Dạ đây ạ', productIds: ['basic'] }),
      { text: 'Dạ em kiểm tra lại ạ.' },
    ]);
    const res = await ask('có những gói nào');
    expect(res.messages?.some((m) => m.ui?.cards)).toBe(false);
    expect(toolResult(fake.calls[1])).toContain('unknown_products');
  });

  it('puts the suggested next steps under the final answer, links from the page only', async () => {
    const { fake, ask } = build([
      call('suggest_next', {
        replies: ['Gói Pro có gì?', 'Gói Pro có gì?'],
        links: [
          { id: 'n1', title: 'Xem bảng giá' },
          { id: 'n9', title: 'Trang lạ' },
        ],
      }),
      { text: 'Dạ shop có gói Basic và Pro ạ.' },
    ]);
    const res = await ask('giá bao nhiêu');
    expect(res.messages?.at(-1)).toEqual({
      text: 'Dạ shop có gói Basic và Pro ạ.',
      images: [],
      ui: {
        suggestions: [
          { kind: 'reply', text: 'Gói Pro có gì?' },
          { kind: 'link', title: 'Xem bảng giá', url: 'https://shop.vn/san-pham#pricing' },
        ],
      },
      via: 'final',
    });
    expect(toolResult(fake.calls[1])).toContain('"unknownLinkIds":["n9"]');
    // The model sees ids and paths, never the full URLs or the visitor's query.
    const turn = String(fake.calls[0]?.messages.at(-1)?.content);
    expect(turn).toContain('"id":"n2"');
    expect(turn).toContain('"path":"/lien-he"');
    expect(turn).not.toContain('utm=1');
  });

  it('drops the suggestions when the turn hands off', async () => {
    const { ask } = build([
      call('suggest_next', { replies: ['Gói Pro có gì?'] }),
      { text: '', stopReason: 'refusal' },
    ]);
    const res = await ask('giá bao nhiêu');
    expect(res.messages?.some((m) => m.ui)).toBe(false);
  });
});

describe('cardPrice', () => {
  it('reads one price, a range start or the offering note', () => {
    expect(cardPrice(basic, 'en')).toBe(formatVnd(200_000));
    expect(cardPrice(pro, 'en')).toBe(`From ${formatVnd(400_000)}`);
    const course = product('c', 'Khoá học', [0, 0], [], {
      kind: 'course',
      priceNote: 'Liên hệ để báo giá',
    });
    expect(cardPrice(course, 'vi')).toBe('Liên hệ để báo giá');
  });
});
