import { FakeLlmProvider, type GenerateRequest } from '@agent-sales/ai-core';
import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { InMemoryLimiter } from '../../../common/limits/limiter.js';
import {
  ConversationLlmBudget,
  LlmBudgetExceededError,
  OwnerLlmBudget,
} from '../../../common/limits/llm-budget.js';
import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { KnowledgeFacade } from '../../knowledge/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import type { LlmRuntime } from '../application/llm-runtime.js';
import { PlaygroundService } from '../application/playground.service.js';
import type { AiSpendLimits } from '../application/spend-guard.js';
import { InMemoryAiRunRepository } from '../infrastructure/persistence/ai-run.repositories.js';

const ws = workspaceId(newId());
const botId = newId();

const bot: BotView = {
  id: botId,
  name: 'Rapiz Bot',
  industry: 'retail',
  isActive: true,
  catalogMode: 'all',
  mission: 'Sell t-shirts',
  greeting: 'Hello',
  selfPronoun: 'em',
  customerPronoun: 'anh/chị',
  fallbackMessage: 'Let me check.',
  handoffMessage: 'Passing you to our staff.',
  creativity: 'balanced',
  modelTier: 'smart',
  language: 'vi',
  profile: { fields: {}, notes: '' },
  replyLength: 'short',
  tone: 'friendly',
  allowEmoji: false,
  placeholders: {},
};

/** A model that always answers; each call reports 10 + 5 tokens. */
function model() {
  const fake = new FakeLlmProvider('dev-fake', () => ({ text: 'A t-shirt is 350.000đ.' }));
  let calls = 0;
  const llm = {
    generate: (req: GenerateRequest) => {
      calls += 1;
      return fake.generate(req, { model: 'echo' });
    },
  } as unknown as LlmRuntime;
  return { llm, calls: () => calls };
}

function service(llm: LlmRuntime, spend: AiSpendLimits) {
  const runs = new InMemoryAiRunRepository();
  const svc = new PlaygroundService(
    { getBot: async () => bot } as unknown as BotFacade,
    { searchFaqs: async () => [] } as unknown as KnowledgeFacade,
    {
      getById: async () => ({ name: 'Shop Lan' }),
      accountOf: async () => 'acc-1',
    } as unknown as WorkspaceFacade,
    llm,
    runs,
    undefined, // training
    undefined, // catalog
    undefined, // actions
    undefined, // promptVersion
    undefined, // summaries
    undefined, // commerce
    undefined, // lodgingCatalog
    undefined, // lodgingBot
    undefined, // lodging
    undefined, // mediaBase
    undefined, // crm
    undefined, // traces
    spend,
  );
  return svc;
}

const ask = { messages: [{ role: 'customer' as const, content: 'how much is a t-shirt' }] };

describe('model spend limits (security audit #15)', () => {
  it('rate-limits playground runs per user before calling the model', async () => {
    const { llm, calls } = model();
    const owner = new OwnerLlmBudget(
      { accountTokensDay: 0, playgroundRunsUserMinute: 2, assistantRunsPerUser: 0 },
      new InMemoryLimiter(),
    );
    const svc = service(llm, { owner });
    await svc.playground(ws, botId, ask, { userId: 'u1' });
    await svc.playground(ws, botId, ask, { userId: 'u1' });
    const before = calls();
    await expect(svc.playground(ws, botId, ask, { userId: 'u1' })).rejects.toBeInstanceOf(
      LlmBudgetExceededError,
    );
    expect(calls()).toBe(before);
    await svc.playground(ws, botId, ask, { userId: 'u2' });
  });

  it("charges every playground call to the account's daily tokens and refuses once spent", async () => {
    const { llm } = model();
    const limiter = new InMemoryLimiter();
    const owner = new OwnerLlmBudget(
      { accountTokensDay: 15, playgroundRunsUserMinute: 0, assistantRunsPerUser: 0 },
      limiter,
    );
    const svc = service(llm, { owner });
    await svc.playground(ws, botId, ask, { userId: 'u1' });
    expect(await limiter.peek('llm:acct:acc-1:tokens:d')).toBeGreaterThanOrEqual(15);
    await expect(svc.playground(ws, botId, ask, { userId: 'u2' })).rejects.toBeInstanceOf(
      LlmBudgetExceededError,
    );
  });

  it('hands a conversation over its hourly model calls to staff without calling the model', async () => {
    const { llm, calls } = model();
    const conversation = new ConversationLlmBudget(
      { callsPerHour: 1, tokensPerHour: 0 },
      new InMemoryLimiter(),
    );
    const svc = service(llm, { conversation });
    const opts = { conversationId: 'conv-1', isTest: false };
    const first = await svc.reply(ws, botId, ask, opts);
    expect(first.outcome).not.toBe('handoff');
    const used = calls();
    expect(used).toBeGreaterThan(0);

    const second = await svc.reply(ws, botId, ask, opts);
    expect(second).toMatchObject({
      outcome: 'handoff',
      guardrail: 'conversation_budget',
      reply: 'Passing you to our staff.',
    });
    expect(calls()).toBe(used);

    const other = await svc.reply(ws, botId, ask, { conversationId: 'conv-2', isTest: false });
    expect(other.outcome).not.toBe('handoff');
  });
});
