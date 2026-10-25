import {
  FakeLlmProvider,
  type GenerateRequest,
  type LlmProvider,
  OpenAiCompatibleProvider,
} from '@agent-sales/ai-core';
import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { TrainingFacade } from '../../knowledge/api/index.js';
import type { FaqHit, KnowledgeFacade } from '../../knowledge/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import { LlmRuntime } from '../application/llm-runtime.js';
import { PlaygroundService } from '../application/playground.service.js';
import type { LlmProviderFactory } from '../application/ports/llm-provider-factory.js';
import { AiNotConfiguredError, AiProviderFailedError } from '../domain/ai.errors.js';
import { DEFAULT_PROVIDER_OPTIONS, type LlmProviderConfig } from '../domain/llm-config.js';
import { InMemoryAiRunRepository } from '../infrastructure/persistence/ai-run.repositories.js';
import { InMemoryLlmConfigRepository } from '../infrastructure/persistence/llm-config.in-memory-repository.js';

const ws = workspaceId(newId());
const botId = newId();

const bot: BotView = {
  id: botId,
  name: 'Rapiz Bot',
  industry: 'retail',
  isActive: true,
  mission: 'Bán áo thun',
  greeting: 'Dạ em chào anh/chị',
  selfPronoun: 'em',
  customerPronoun: 'anh/chị',
  fallbackMessage: 'Dạ để em kiểm tra lại rồi báo anh/chị nhé.',
  handoffMessage: 'Dạ em chuyển nhân viên ạ.',
  creativity: 'balanced',
  modelTier: 'smart',
  language: 'vi',
  placeholders: { 'store.hotline': '0901234567' },
};

const hit: FaqHit = {
  id: newId(),
  botId,
  question: 'Áo thun giá bao nhiêu?',
  answer: 'Dạ áo thun giá 350.000đ, hotline {{store.hotline}}',
  source: 'manual',
  updatedAt: new Date(),
  score: 0.8,
};

function provider(name: string, reply: object | Error): FakeLlmProvider {
  return new FakeLlmProvider(name, () =>
    reply instanceof Error ? reply : { text: JSON.stringify(reply) },
  );
}

function factory(
  dev: LlmProvider | null,
  real: Record<string, LlmProvider> = {},
): LlmProviderFactory {
  return {
    create: (c: LlmProviderConfig) => {
      const p = real[c.name];
      if (!p) throw new Error(`no stub for ${c.name}`);
      return p;
    },
    hermesLogin: () => {
      throw new Error('not used');
    },
    listModels: () => Promise.resolve({ models: [], state: 'unavailable' }),
    developmentFallback: () => (dev ? { provider: dev, model: 'echo' } : null),
  };
}

function service(llm: LlmRuntime, botView: typeof bot = bot) {
  const runs = new InMemoryAiRunRepository();
  const svc = new PlaygroundService(
    { getBot: async () => botView } as BotFacade,
    { searchFaqs: async () => [hit] } as unknown as KnowledgeFacade,
    { getById: async () => ({ name: 'Shop Lan' }) } as unknown as WorkspaceFacade,
    llm,
    runs,
  );
  return { svc, runs };
}

const ask = (text: string) => ({ messages: [{ role: 'customer' as const, content: text }] });

function providerConfig(name: string, isEnabled = true): LlmProviderConfig {
  return {
    id: newId(),
    name,
    kind: 'openai_compatible',
    baseUrl: 'http://x/v1',
    apiKeyCipher: null,
    apiKeyHint: null,
    options: DEFAULT_PROVIDER_OPTIONS,
    isEnabled,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('PlaygroundService', () => {
  it('sends the filled knowledge as data and records a test run with the cited source', async () => {
    const fake = provider('dev-fake', {
      outcome: 'answer',
      reply: 'Dạ áo thun giá 350k ạ, hotline 0901234567',
      sources: ['kb:1', 'kb:9'],
    });
    const { svc, runs } = service(new LlmRuntime(new InMemoryLlmConfigRepository(), factory(fake)));
    const res = await svc.playground(ws, botId, ask('ao thun bao nhieu'));

    expect(res.outcome).toBe('answered');
    expect(res.sources).toEqual([expect.objectContaining({ faqId: hit.id, used: true })]);
    const sent = fake.calls[0] as GenerateRequest;
    expect(sent.messages[0]?.role).toBe('system');
    expect(sent.messages[0]?.content).toContain('Shop Lan');
    expect(sent.messages.at(-1)?.content).toContain('[kb:1]');
    expect(sent.messages.at(-1)?.content).toContain('0901234567');
    expect(sent.messages.at(-1)?.content).toContain('<customer>\nao thun bao nhieu\n</customer>');
    expect(runs.runs).toEqual([
      expect.objectContaining({
        workspaceId: ws,
        isTest: true,
        outcome: 'answered',
        promptVersion: 'sales-agent@8',
      }),
    ]);
  });

  it('introduces the shop by the store name setting, not the workspace name', async () => {
    const fake = provider('dev-fake', { outcome: 'answer', reply: 'Dạ ạ', sources: [] });
    const named = { ...bot, placeholders: { ...bot.placeholders, 'store.name': 'TinyMind Store' } };
    const { svc } = service(
      new LlmRuntime(new InMemoryLlmConfigRepository(), factory(fake)),
      named,
    );
    await svc.playground(ws, botId, ask('hi'));
    const system = JSON.stringify((fake.calls[0] as { messages: unknown[] }).messages[0]);
    expect(system).toContain('TinyMind Store');
  });

  it('replaces a reply whose price is not in the sources with the fallback message', async () => {
    const fake = provider('dev-fake', {
      outcome: 'answer',
      reply: 'Dạ giá 299k ạ',
      sources: ['kb:1'],
    });
    const { svc, runs } = service(new LlmRuntime(new InMemoryLlmConfigRepository(), factory(fake)));
    const res = await svc.playground(ws, botId, ask('ao thun bao nhieu'));
    expect(res).toMatchObject({
      outcome: 'fallback',
      reply: bot.fallbackMessage,
      guardrail: 'ungrounded_figure:299k',
    });
    expect(runs.runs[0]?.guardrail).toBe('ungrounded_figure:299k');
  });

  it('treats unparseable output and provider refusals safely', async () => {
    const garbage = new FakeLlmProvider('dev-fake', () => ({ text: '{"outcome": broken' }));
    const a = service(new LlmRuntime(new InMemoryLlmConfigRepository(), factory(garbage)));
    expect(await a.svc.playground(ws, botId, ask('hi'))).toMatchObject({
      outcome: 'fallback',
      guardrail: 'invalid_output:not_json',
    });

    const refusal = new FakeLlmProvider('dev-fake', () => ({ text: '', stopReason: 'refusal' }));
    const b = service(new LlmRuntime(new InMemoryLlmConfigRepository(), factory(refusal)));
    expect(await b.svc.playground(ws, botId, ask('hi'))).toMatchObject({
      outcome: 'handoff',
      reply: bot.handoffMessage,
    });
  });
});

describe('PlaygroundService invalid model output', () => {
  const valid = {
    outcome: 'answer',
    reply: 'Dạ áo thun giá 350k ạ',
    sources: ['kb:1'],
  };
  function scripted(...texts: string[]) {
    let i = 0;
    const fake = new FakeLlmProvider('dev-fake', () => ({
      text: texts[Math.min(i++, texts.length - 1)] ?? '',
    }));
    const built = service(new LlmRuntime(new InMemoryLlmConfigRepository(), factory(fake)));
    return { fake, ...built };
  }

  it('retries once and answers when the second output is valid', async () => {
    const { fake, svc, runs } = scripted('Xin lỗi, đây là câu trả lời', JSON.stringify(valid));
    const res = await svc.playground(ws, botId, ask('ao thun bao nhieu'));
    expect(res).toMatchObject({ outcome: 'answered', guardrail: null });
    expect(fake.calls).toHaveLength(2);
    expect(runs.runs).toHaveLength(1);
  });

  it('reminds the model of the JSON format on the retry only', async () => {
    const { fake, svc } = scripted('Xin lỗi, đây là câu trả lời', JSON.stringify(valid));
    await svc.playground(ws, botId, ask('ao thun bao nhieu'));
    const first = JSON.stringify((fake.calls[0] as { messages: unknown[] }).messages);
    const second = JSON.stringify((fake.calls[1] as { messages: unknown[] }).messages);
    expect(first).not.toContain('previous reply was not a JSON object');
    expect(second).toContain('previous reply was not a JSON object');
  });

  it('falls back after two invalid outputs and records the rejection category only', async () => {
    const { fake, svc, runs } = scripted('plain text one', '{"outcome":"answer","reply":"x"}');
    const res = await svc.playground(ws, botId, ask('ao thun bao nhieu'));
    expect(res).toMatchObject({
      outcome: 'fallback',
      reply: bot.fallbackMessage,
      guardrail: 'invalid_output:schema',
    });
    expect(fake.calls).toHaveLength(2);
    expect(JSON.stringify(runs.runs)).not.toContain('plain text one');
  });

  it('keeps a plain-prose answer after the retry, but the number guard still applies', async () => {
    const kept = scripted('Dạ cửa hàng có áo thun ạ.', 'Dạ cửa hàng có áo thun và áo sơ mi ạ.');
    const res = await kept.svc.playground(ws, botId, ask('shop có mẫu nào'));
    expect(res).toMatchObject({
      outcome: 'answered',
      reply: 'Dạ cửa hàng có áo thun và áo sơ mi ạ.',
    });
    const priced = scripted('Dạ giá 299k ạ.', 'Dạ giá 299k ạ.');
    expect((await priced.svc.playground(ws, botId, ask('ao thun bao nhieu'))).outcome).toBe(
      'fallback',
    );
  });

  it('does not retry a valid output that is merely ungrounded', async () => {
    const { fake, svc } = scripted(JSON.stringify({ ...valid, reply: 'Dạ giá 299k ạ' }));
    const res = await svc.playground(ws, botId, ask('ao thun bao nhieu'));
    expect(res.guardrail).toBe('ungrounded_figure:299k');
    expect(fake.calls).toHaveLength(1);
  });

  it('accepts JSON wrapped in a code fence on the first try', async () => {
    const { fake, svc } = scripted('```json\n' + JSON.stringify(valid) + '\n```');
    expect((await svc.playground(ws, botId, ask('ao thun bao nhieu'))).outcome).toBe('answered');
    expect(fake.calls).toHaveLength(1);
  });
});

describe('PlaygroundService fallback and handoff text', () => {
  it('never sends model text when the bot has no fallback message', async () => {
    const fake = provider('dev-fake', {
      outcome: 'unknown',
      reply: 'Dạ khoảng 500k ạ',
      sources: [],
    });
    const runs = new InMemoryAiRunRepository();
    const svc = new PlaygroundService(
      { getBot: async () => ({ ...bot, fallbackMessage: '', handoffMessage: '' }) } as BotFacade,
      { searchFaqs: async () => [] } as unknown as KnowledgeFacade,
      { getById: async () => ({ name: 'Shop Lan' }) } as unknown as WorkspaceFacade,
      new LlmRuntime(new InMemoryLlmConfigRepository(), factory(fake)),
      runs,
    );
    const res = await svc.playground(ws, botId, ask('ao bao nhieu'));
    expect(res.outcome).toBe('fallback');
    expect(res.reply).not.toContain('500k');
    expect(res.reply).toBe(
      'Dạ, em chưa có thông tin này ạ. Anh/chị nhắn rõ hơn hoặc để lại số điện thoại để nhân viên hỗ trợ giúp mình nhé.',
    );
  });

  it('does not let the customer make the bot confirm a price', async () => {
    const fake = provider('dev-fake', { outcome: 'answer', reply: 'Dạ đúng 99k ạ', sources: [] });
    const { svc } = service(new LlmRuntime(new InMemoryLlmConfigRepository(), factory(fake)));
    const res = await svc.playground(ws, botId, ask('ao 99k dung ko shop'));
    expect(res).toMatchObject({ outcome: 'fallback', guardrail: 'ungrounded_figure:99k' });
  });
});

describe('LlmRuntime', () => {
  const req: GenerateRequest = {
    workspaceId: ws,
    tier: 'smart',
    messages: [{ role: 'user', content: 'hi' }],
  };

  it('routes a tier to the configured provider and model, and sees admin changes after invalidate()', async () => {
    const repo = new InMemoryLlmConfigRepository();
    const self = providerConfig('selfhost');
    await repo.saveProvider(self);
    const selfhost = provider('selfhost', {});
    const runtime = new LlmRuntime(repo, factory(provider('dev-fake', {}), { selfhost }));

    expect((await runtime.generate(req)).provider).toBe('dev-fake');
    await repo.saveRoute({
      tier: 'smart',
      primary: { providerId: self.id, model: 'qwen3-32b', effort: 'low' },
      fallback: null,
      updatedBy: null,
      updatedAt: new Date(),
    });
    runtime.invalidate();
    const res = await runtime.generate(req);
    expect(res).toMatchObject({ provider: 'selfhost', model: 'qwen3-32b' });
  });

  it('runs on the fallback when the primary provider is disabled or failing', async () => {
    const repo = new InMemoryLlmConfigRepository();
    const off = providerConfig('off', false);
    const bad = providerConfig('bad');
    const backup = providerConfig('backup');
    for (const p of [off, bad, backup]) await repo.saveProvider(p);
    const stubs = {
      off: provider('off', {}),
      bad: provider('bad', new Error('boom')),
      backup: provider('backup', {}),
    };
    await repo.saveRoute({
      tier: 'smart',
      primary: { providerId: off.id, model: 'm', effort: null },
      fallback: { providerId: backup.id, model: 'b', effort: null },
      updatedBy: null,
      updatedAt: new Date(),
    });
    await repo.saveRoute({
      tier: 'pro',
      primary: { providerId: bad.id, model: 'm', effort: null },
      fallback: { providerId: backup.id, model: 'b', effort: null },
      updatedBy: null,
      updatedAt: new Date(),
    });
    const runtime = new LlmRuntime(repo, factory(null, stubs));
    expect((await runtime.generate(req)).provider).toBe('backup');
    expect((await runtime.generate({ ...req, tier: 'pro' })).provider).toBe('backup');
    expect(stubs.off.calls).toHaveLength(0);
  });

  it('skips a provider that cannot be built and serves the tier from its fallback', async () => {
    const repo = new InMemoryLlmConfigRepository();
    const broken = providerConfig('broken');
    const backup = providerConfig('backup');
    for (const p of [broken, backup]) await repo.saveProvider(p);
    await repo.saveRoute({
      tier: 'smart',
      primary: { providerId: broken.id, model: 'm', effort: null },
      fallback: { providerId: backup.id, model: 'b', effort: null },
      updatedBy: null,
      updatedAt: new Date(),
    });
    // `factory` throws for names without a stub, like a key that no longer decrypts.
    const runtime = new LlmRuntime(repo, factory(null, { backup: provider('backup', {}) }));
    expect((await runtime.generate(req)).provider).toBe('backup');
  });

  it('answers AI_UNAVAILABLE when the configuration cannot be loaded', async () => {
    const repo = new InMemoryLlmConfigRepository();
    repo.listProviders = async () => {
      throw new Error('db down');
    };
    const runtime = new LlmRuntime(repo, factory(provider('dev-fake', {})));
    await expect(runtime.generate(req)).rejects.toBeInstanceOf(AiProviderFailedError);
  });

  it('refuses unconfigured tiers when there is no development fallback (production)', async () => {
    const runtime = new LlmRuntime(new InMemoryLlmConfigRepository(), factory(null));
    await expect(runtime.generate(req)).rejects.toBeInstanceOf(AiNotConfiguredError);
  });
});

describe('channel metering and training context evals', () => {
  it('records real conversation replies separately from playground runs', async () => {
    const fake = provider('dev-fake', { outcome: 'answer', reply: 'Hello', sources: [] });
    const { svc, runs } = service(new LlmRuntime(new InMemoryLlmConfigRepository(), factory(fake)));
    const conversationId = newId();
    await svc.reply(ws, botId, ask('hello'), { conversationId, isTest: false });
    expect(runs.runs[0]).toMatchObject({ conversationId, isTest: false, workspaceId: ws });
  });

  it('passes only scenario material and grounds its business figures', async () => {
    const fake = provider('dev-fake', {
      outcome: 'answer',
      reply: 'Delivery costs 50k',
      sources: [],
    });
    const runs = new InMemoryAiRunRepository();
    const training = {
      list: async () => [
        { kind: 'scenario', title: 'Delivery', content: 'Delivery costs 50.000 VND.' },
        {
          kind: 'quick_reply',
          title: 'Private shortcut',
          content: 'Do not include this staff shortcut.',
        },
      ],
    } as unknown as TrainingFacade;
    const svc = new PlaygroundService(
      { getBot: async () => bot } as BotFacade,
      { searchFaqs: async () => [] } as unknown as KnowledgeFacade,
      { getById: async () => ({ name: 'Shop Lan' }) } as unknown as WorkspaceFacade,
      new LlmRuntime(new InMemoryLlmConfigRepository(), factory(fake)),
      runs,
      training,
    );
    const result = await svc.playground(ws, botId, ask('delivery fee'));
    expect(result.outcome).toBe('answered');
    expect(fake.calls[0]?.messages.at(-1)?.content).toContain('50.000 VND');
    expect(fake.calls[0]?.messages.at(-1)?.content).not.toContain('Private shortcut');
  });
});

describe('sales-agent prompt and handoff reply', () => {
  const trainingWith = (items: object[]) =>
    ({ list: async () => items }) as unknown as TrainingFacade;
  const build = (reply: object, items: object[] = []) => {
    const fake = provider('dev-fake', reply);
    const svc = new PlaygroundService(
      { getBot: async () => bot } as BotFacade,
      { searchFaqs: async () => [] } as unknown as KnowledgeFacade,
      { getById: async () => ({ name: 'Shop Lan' }) } as unknown as WorkspaceFacade,
      new LlmRuntime(new InMemoryLlmConfigRepository(), factory(fake)),
      new InMemoryAiRunRepository(),
      trainingWith(items),
    );
    return { fake, svc };
  };

  it('puts situation handling before the handoff rule and keeps the style rules', async () => {
    const { fake, svc } = build({ outcome: 'answer', reply: 'Dạ', sources: [] });
    await svc.playground(ws, botId, ask('hi'));
    const system = String(fake.calls[0]?.messages[0]?.content);
    expect(system.indexOf('<shop_situations> are the owner')).toBeGreaterThan(-1);
    expect(system.indexOf('follow it')).toBeLessThan(system.indexOf('"handoff" only when'));
    expect(system).toContain('Never call yourself "shop"');
    expect(system).toContain('Greet only when the conversation is a single <customer> block');
    expect(system).toContain('never start with a greeting');
    expect(system).toContain('Answer every question in the last <customer> block');
    expect(system).toContain('Promise no follow-up');
    expect(system).toContain(
      'Answer each question the blocks can answer, even when another one cannot',
    );
    expect(system).toContain('the "unknown" fallback is only for when none can be answered');
    expect(system).toContain('State only facts that appear in the blocks');
    expect(system).toContain('Never add inferred conclusions');
    expect(system).toContain('never announce that you are about to answer');
    expect(system).toContain('use outcome "handoff" and let "reply" confirm it');
    expect(system).toContain('language other than Vietnamese');
    expect(system).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it('passes customer images to the provider and tells the model how to use them', async () => {
    const { fake, svc } = build({ outcome: 'answer', reply: 'Dạ', sources: [] });
    const images = [{ mimeType: 'image/png' as const, base64: 'iVBORw0KGgo=' }];
    await svc.playground(ws, botId, { ...ask('giá bao nhiêu?'), images });
    expect(fake.calls[0]?.images).toEqual(images);
    const system = String(fake.calls[0]?.messages[0]?.content);
    expect(system).toContain(
      'Never read or invent a price, stock level, policy or promotion from an image',
    );
    expect(system).toContain('ask a clarifying question');
    await svc.playground(ws, botId, ask('hi'));
    expect(fake.calls[1]).not.toHaveProperty('images');
  });

  it('fails clearly when the resolved provider cannot take images', async () => {
    const text = new OpenAiCompatibleProvider({
      name: 'dev-fake',
      baseURL: 'http://127.0.0.1:1/v1',
      apiKey: 'k',
    });
    const svc = new PlaygroundService(
      { getBot: async () => bot } as BotFacade,
      { searchFaqs: async () => [] } as unknown as KnowledgeFacade,
      { getById: async () => ({ name: 'Shop Lan' }) } as unknown as WorkspaceFacade,
      new LlmRuntime(new InMemoryLlmConfigRepository(), factory(text)),
      new InMemoryAiRunRepository(),
    );
    await expect(
      svc.playground(ws, botId, {
        ...ask('x'),
        images: [{ mimeType: 'image/png', base64: 'iVBORw0KGgo=' }],
      }),
    ).rejects.toBeInstanceOf(AiProviderFailedError);
  });

  it('shows the "when" line of each situation to the model', async () => {
    const { fake, svc } = build({ outcome: 'answer', reply: 'Dạ', sources: [] }, [
      {
        kind: 'scenario',
        title: 'Giá sỉ',
        trigger: 'Khách hỏi giá sỉ',
        content: 'Xin số điện thoại.',
      },
    ]);
    await svc.playground(ws, botId, ask('giá sỉ'));
    expect(fake.calls[0]?.messages.at(-1)?.content).toContain('Khi: Khách hỏi giá sỉ');
  });

  it('puts a brief model acknowledgement before the shop handoff message', async () => {
    const { svc } = build({
      outcome: 'handoff',
      reply: 'Em xin lỗi anh/chị về trải nghiệm này ạ.',
      sources: [],
    });
    const res = await svc.playground(ws, botId, ask('dịch vụ tệ quá'));
    expect(res).toMatchObject({
      outcome: 'handoff',
      reply: `Em xin lỗi anh/chị về trải nghiệm này ạ. ${bot.handoffMessage}`,
    });
  });

  it('repeats a phone number the customer gave, but drops an invented figure', async () => {
    const ok = build({ outcome: 'handoff', reply: 'Em đã ghi nhận số 0912345678 ạ.', sources: [] });
    const a = await ok.svc.playground(ws, botId, ask('gọi lại số 0912345678 nhé'));
    expect(a.reply).toBe(`Em đã ghi nhận số 0912345678 ạ. ${bot.handoffMessage}`);

    const bad = build({
      outcome: 'handoff',
      reply: 'Em xin lỗi, em giảm 20% cho anh ạ.',
      sources: [],
    });
    const b = await bad.svc.playground(ws, botId, ask('tệ quá'));
    expect(b.reply).toBe(bot.handoffMessage);
  });

  it('sends only the shop handoff message when the model adds nothing', async () => {
    const { svc } = build({ outcome: 'handoff', reply: '', sources: [] });
    expect((await svc.playground(ws, botId, ask('gặp người thật'))).reply).toBe(bot.handoffMessage);
  });

  it('keeps the English fallback pronouns and never leaks model text on fallback', async () => {
    const { svc } = build({ outcome: 'unknown', reply: 'Chắc 500k ạ', sources: [] });
    const res = await svc.playground(ws, botId, ask('Hi, how much?'));
    expect(res).toMatchObject({ outcome: 'fallback', reply: bot.fallbackMessage });
  });
});
