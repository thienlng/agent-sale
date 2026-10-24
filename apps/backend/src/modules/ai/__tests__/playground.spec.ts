import { FakeLlmProvider, type GenerateRequest, type LlmProvider } from '@agent-sales/ai-core';
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
    developmentFallback: () => (dev ? { provider: dev, model: 'echo' } : null),
  };
}

function service(llm: LlmRuntime) {
  const runs = new InMemoryAiRunRepository();
  const svc = new PlaygroundService(
    { getBot: async () => bot } as BotFacade,
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
        promptVersion: 'sales-agent@3',
      }),
    ]);
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
    const garbage = new FakeLlmProvider('dev-fake', () => ({ text: 'not json' }));
    const a = service(new LlmRuntime(new InMemoryLlmConfigRepository(), factory(garbage)));
    expect(await a.svc.playground(ws, botId, ask('hi'))).toMatchObject({
      outcome: 'fallback',
      guardrail: 'invalid_output',
    });

    const refusal = new FakeLlmProvider('dev-fake', () => ({ text: '', stopReason: 'refusal' }));
    const b = service(new LlmRuntime(new InMemoryLlmConfigRepository(), factory(refusal)));
    expect(await b.svc.playground(ws, botId, ask('hi'))).toMatchObject({
      outcome: 'handoff',
      reply: bot.handoffMessage,
    });
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
      'Dạ, em chưa có thông tin này, em sẽ kiểm tra lại và báo anh/chị ngay ạ.',
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
