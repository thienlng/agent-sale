import {
  FakeLlmProvider,
  type GenerateRequest,
  type GenerateResponse,
  type LlmProvider,
} from '@agent-sales/ai-core';
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

/** A scripted model step: a final reply, or the catalog search every product turn starts with. */
const search = (query = 'giày'): Partial<GenerateResponse> => ({
  text: '',
  stopReason: 'tool_use',
  toolCalls: [{ id: 'c1', name: 'search_products', input: { query } }],
});

/** `send_message` calls with these id lists, one call each. */
const send = (...calls: string[][]): Partial<GenerateResponse> => ({
  text: '',
  stopReason: 'tool_use',
  toolCalls: calls.map((imageIds, i) => ({
    id: `s${i + 1}`,
    name: 'send_message',
    input: { imageIds },
  })),
});

/**
 * A scripted turn: the catalog search (unless `searchFirst` is false), then the `send_message`
 * calls of `reply.sends` (one round), then the free-text answer.
 */
function build(
  reply: { sends?: string[][]; text?: string } | string,
  options: { products?: ProductDto[]; focus?: string[]; searchFirst?: boolean } = {},
) {
  const { products = [oxford], focus = [], searchFirst = true } = options;
  const { sends = [], text = 'Dạ đây là hình ạ.' } =
    typeof reply === 'string' ? { text: reply } : reply;
  const script: Partial<GenerateResponse>[] = [
    ...(searchFirst ? [search()] : []),
    ...(sends.length ? [send(...sends)] : []),
    { text },
  ];
  const fake = new FakeLlmProvider('dev-fake', () =>
    script.length > 1 ? (script.shift() ?? {}) : (script[0] ?? {}),
  );
  const factory: LlmProviderFactory = {
    create: () => fake as LlmProvider,
    hermesLogin: () => {
      throw new Error('unused');
    },
    listModels: () => Promise.resolve({ models: [], state: 'unavailable' }),
    developmentFallback: () => ({ provider: fake, model: 'echo' }),
  };
  const lookups: string[][] = [];
  const runs = new InMemoryAiRunRepository();
  const svc = new PlaygroundService(
    { getBot: async () => bot } as BotFacade,
    { searchFaqs: async () => [] } as unknown as KnowledgeFacade,
    { getById: async () => ({ name: 'Shop' }) } as unknown as WorkspaceFacade,
    new LlmRuntime(new InMemoryLlmConfigRepository(), factory),
    runs,
    { list: async () => [media] } as unknown as TrainingFacade,
    {
      searchBotCatalog: async () => products,
      countBotCatalog: async () => products.length,
      getBotProductsByIds: async (_ws: unknown, _bot: unknown, ids: readonly string[]) => {
        lookups.push([...ids]);
        return products.filter((p) => ids.includes(p.id));
      },
    } as unknown as CatalogFacade,
  );
  const conversationId = newId();
  const askWith = async (messages: PlaygroundRequest['messages']) => {
    if (focus.length)
      await runs.record(ws, {
        id: newId(),
        botId,
        conversationId,
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
        productIds: focus,
        createdAt: new Date(),
      });
    return svc.reply(ws, botId, { messages }, { conversationId, isTest: false });
  };
  const ask = (text: string) => askWith([{ role: 'customer', content: text }]);
  return { fake, ask, askWith, lookups, runs, conversationId };
}

const answer = (imageIds?: string[]) => (imageIds?.length ? { sends: [imageIds] } : {});
/** The content of the tool message answering `send_message` call `id`. */
const toolResult = (req: GenerateRequest | undefined, id = 's1') =>
  req?.messages.find((m) => m.role === 'tool' && m.toolCallId === id)?.content;
/** Everything after the system prompt (which names the blocks it explains). */
const requestText = (req: GenerateRequest | undefined) => JSON.stringify(req?.messages.slice(1));

describe('bot-sent images', () => {
  it('resolves valid ids to stored URLs and shows the model ids and labels only', async () => {
    const { fake, ask } = build(answer(['p:oxford:1', 'm:size']));
    const res = await ask('cho xem ảnh giày Oxford và bảng size giày');
    expect(res.images).toEqual([
      { url: 'https://img.example.com/ox2.jpg', label: 'Giày da Oxford (2/4)' },
      { url: 'https://img.example.com/size.png', label: 'Bảng size giày' },
    ]);
    expect(res.messages).toEqual([
      {
        text: '',
        images: [
          {
            id: 'p:oxford:1',
            url: 'https://img.example.com/ox2.jpg',
            label: 'Giày da Oxford (2/4)',
          },
          { id: 'm:size', url: 'https://img.example.com/size.png', label: 'Bảng size giày' },
        ],
        via: 'send_message',
      },
      { text: 'Dạ đây là hình ạ.', images: [], via: 'final' },
    ]);
    // The library image is offered up front; the product pictures come back with its details.
    expect(requestText(fake.calls[0])).toContain('m:size: Bảng size giày');
    expect(requestText(fake.calls[1])).toContain('p:oxford:0');
    for (const call of fake.calls) expect(JSON.stringify(call)).not.toContain('img.example.com');
  });

  it('tells the model to send the pictures its details list and never to deny them', async () => {
    const { fake, ask } = build(answer());
    await ask('cho xem ảnh giày da Oxford');
    const system = String(fake.calls[0]?.messages[0]?.content);
    expect(system).toContain('send their pictures with send_message');
    expect(system).toContain('Each call takes optional text and up to 3 image ids');
    expect(system).toContain('Never say a product has no picture when its details list images');
  });

  it('drops an invented or foreign id and tells the model which ones', async () => {
    const { fake, ask } = build(answer(['p:other:0', 'm:nope', 'p:oxford:0']));
    expect((await ask('cho xem ảnh giày')).images).toEqual([
      { url: 'https://img.example.com/ox1.jpg', label: 'Giày da Oxford (1/4)' },
    ]);
    expect(JSON.parse(toolResult(fake.calls[2]) ?? '{}')).toEqual({
      status: 'sent',
      delivered: 1,
      droppedImageIds: ['p:other:0', 'm:nope'],
    });
  });

  it('drops the picture of a product the model never saw this turn', async () => {
    const { fake, ask } = build(answer(['p:oxford:0']), { searchFirst: false });
    const res = await ask('cho xem ảnh giày');
    expect(res.images).toEqual([]);
    expect(res.messages?.map((m) => m.via)).toEqual(['final']);
    expect(toolResult(fake.calls[1])).toContain('nothing_to_send');
  });

  it('ignores URL-looking strings', async () => {
    const { ask } = build(
      answer(['https://img.example.com/ox1.jpg', 'https://evil.example/x.png']),
    );
    expect((await ask('cho xem ảnh giày')).images).toEqual([]);
  });

  it('takes at most 3 ids per call, dedupes, and lets several calls send more', async () => {
    const tooMany = build(answer(['p:oxford:0', 'p:oxford:1', 'p:oxford:2', 'p:oxford:3']));
    const rejected = await tooMany.ask('cho xem ảnh giày');
    expect(rejected.images).toEqual([]);
    expect(toolResult(tooMany.fake.calls[2])).toContain('invalid_arguments');

    const two = build({
      sends: [
        ['p:oxford:0', 'p:oxford:0', 'p:oxford:1'],
        ['p:oxford:2', 'p:oxford:3'],
      ],
    });
    const res = await two.ask('cho xem hết ảnh giày');
    expect(
      res.messages?.filter((m) => m.via === 'send_message').map((m) => m.images.length),
    ).toEqual([2, 2]);
    // The joined view keeps its contract cap of 3; `messages` lists every picture.
    expect(res.images).toHaveLength(3);
  });

  it('returns no pictures when the model sends none or omits the field', async () => {
    expect((await build(answer([])).ask('giá giày bao nhiêu')).images).toEqual([]);
    expect((await build(answer()).ask('giá giày bao nhiêu')).images).toEqual([]);
  });

  it('has no allowlist block when nothing can be sent', async () => {
    const { fake, ask } = build(answer(), { products: [product('plain', 'Dép', [])] });
    await ask('giá dép');
    for (const call of fake.calls) expect(requestText(call)).not.toContain('Images you may send');
  });

  it('records the products whose pictures were sent next to the ones the tools returned', async () => {
    const other = product('other', 'Dép da', ['https://img.example.com/d1.jpg']);
    const { ask, runs } = build(answer(['p:other:0']), { products: [oxford, other] });
    const res = await ask('cho xem ảnh dép');
    expect(res.images).toHaveLength(1);
    expect(runs.runs[0]?.productIds).toEqual(['oxford', 'other']);
  });
});

describe('focus products carry the product being discussed', () => {
  const thread: PlaygroundRequest['messages'] = [
    { role: 'customer', content: 'cho xem ảnh giày da Oxford' },
    { role: 'bot', content: 'Dạ em gửi ảnh giày da nam Oxford ạ.' },
    { role: 'customer', content: 'gửi thêm ảnh đi' },
  ];

  it('gives the details and pictures of the last run products with no tool call', async () => {
    const { fake, askWith, lookups } = build(answer(['p:oxford:2']), {
      focus: ['oxford'],
      searchFirst: false,
    });
    const res = await askWith(thread);
    // No catalog call: the focus product's pictures are sendable straight away.
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]?.toolChoice).toBeUndefined();
    expect(lookups).toEqual([['oxford']]);
    const sent = String(fake.calls[0]?.messages.at(-1)?.content);
    expect(sent).toContain('<focus_products>');
    expect(sent).toContain('Giày da Oxford');
    expect(sent).toContain('p:oxford:0: Giày da Oxford (1/4)');
    expect(res.images).toEqual([
      { url: 'https://img.example.com/ox3.jpg', label: 'Giày da Oxford (3/4)' },
    ]);
  });

  it('shows no focus block when the conversation has no earlier run', async () => {
    const { fake, askWith } = build(answer(), { searchFirst: false });
    await askWith(thread);
    expect(requestText(fake.calls[0])).not.toContain('<focus_products>');
  });
});

describe('free-text answers', () => {
  it('sends a plain-prose answer as is, in one model call', async () => {
    const { fake, ask } = build('Dạ, cửa hàng có giày da nam Oxford và giày lười Loafer ạ.', {
      searchFirst: false,
    });
    const res = await ask('shop có những mẫu nào vậy?');
    expect(res.outcome).toBe('answered');
    expect(res.reply).toBe('Dạ, cửa hàng có giày da nam Oxford và giày lười Loafer ạ.');
    expect(fake.calls).toHaveLength(1);
  });
  it('offers the catalog as tools and puts no catalog or overview in the request', async () => {
    const { fake, ask } = build(answer(), { searchFirst: false });
    await ask('shop có những mẫu nào vậy?');
    expect(fake.calls[0]?.tools?.map((t) => t.name)).toEqual([
      'search_products',
      'product_details',
      'send_message',
      'handoff',
    ]);
    const sent = requestText(fake.calls[0]);
    expect(sent).not.toContain('<catalog');
    expect(sent).not.toContain(oxford.name);
  });
});
