import { FakeLlmProvider, type GenerateRequest } from '@agent-sales/ai-core';
import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { CommerceFacade } from '../../commerce/api/index.js';
import type { CrmFacade } from '../../crm/api/index.js';
import type { KnowledgeFacade } from '../../knowledge/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import type { LlmRuntime } from '../application/llm-runtime.js';
import { PREPARE_ORDER_TOOL } from '../application/order-tools.js';
import {
  PlaygroundService,
  PROMPT_BY_INDUSTRY,
  salesPromptFor,
} from '../application/playground.service.js';
import { REQUEST_TOOL } from '../application/request-tools.js';
import { InMemoryAiRunRepository } from '../infrastructure/persistence/ai-run.repositories.js';

const ws = workspaceId(newId());
const botId = newId();

const botOf = (industry: string, orderTaking = false): BotView =>
  ({
    id: botId,
    name: 'Bot',
    industry,
    isActive: true,
    catalogMode: 'all',
    mission: '',
    greeting: 'Dạ',
    selfPronoun: 'em',
    customerPronoun: 'anh/chị',
    fallbackMessage: 'fallback',
    handoffMessage: 'handoff',
    creativity: 'balanced',
    modelTier: 'smart',
    language: 'vi',
    profile: { fields: {}, notes: '' },
    replyLength: 'short',
    tone: 'friendly',
    allowEmoji: false,
    placeholders: {},
    orderTaking,
    orderShippingFeeVnd: null,
  }) as unknown as BotView;

const commerce = {
  hasBotOrderDraft: vi.fn(async () => ({ pending: false, storedAt: null })),
} as unknown as CommerceFacade;
const crm = { recordBotRequest: vi.fn() } as unknown as CrmFacade;

/** One turn of a bot of `industry`: the offered tools and the prompt version of its run. */
async function turn(industry: string, orderTaking = false) {
  const requests: GenerateRequest[] = [];
  const fake = new FakeLlmProvider('dev-fake', (req: GenerateRequest) => {
    requests.push(req);
    return { text: 'Dạ em chào chị ạ.' };
  });
  const runs = new InMemoryAiRunRepository();
  const svc = new PlaygroundService(
    { getBot: async () => botOf(industry, orderTaking) } as BotFacade,
    { searchFaqs: async () => [] } as unknown as KnowledgeFacade,
    { getById: async () => ({ name: 'Shop' }) } as unknown as WorkspaceFacade,
    { generate: (req: GenerateRequest) => fake.generate(req, { model: 'echo' }) } as LlmRuntime,
    runs,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    commerce,
    undefined,
    undefined,
    undefined,
    undefined,
    crm,
  );
  await svc.reply(
    ws,
    botId,
    { messages: [{ role: 'customer', content: 'chào shop' }] },
    {
      conversationId: newId(),
      isTest: false,
    },
  );
  return {
    tools: (requests[0]?.tools ?? []).map((t) => t.name),
    system: requests[0]?.messages.find((m) => m.role === 'system')?.content ?? '',
    promptVersion: runs.runs.at(-1)?.promptVersion,
  };
}

describe('industry wiring of the reply pipeline (ESV §5.3)', () => {
  it('maps the request industries to @26, hotel to @25 and the rest to @27', async () => {
    expect(PROMPT_BY_INDUSTRY).toMatchObject({ saas: 26, education: 26, spa: 26, hotel: 25 });
    for (const industry of ['saas', 'education', 'spa'])
      expect((await turn(industry)).promptVersion, industry).toBe('sales-agent@26');
    expect((await turn('hotel')).promptVersion).toBe('sales-agent@25');
    expect((await turn('retail')).promptVersion).toBe('sales-agent@27');
    expect(salesPromptFor('fashion')).toEqual({ name: 'sales-agent', version: 27 });
  });

  it('the @19 system prompt carries the request section and the course / service facts', async () => {
    const { system } = await turn('spa');
    expect(system).toContain('Recording a request (only when your tools include record_request)');
    expect(system).toContain('catalogKind course or service');
    expect((await turn('retail')).system).not.toContain('record_request');
  });

  it('offers record_request only to the request industries', async () => {
    for (const industry of ['saas', 'education', 'spa'])
      expect((await turn(industry)).tools, industry).toContain(REQUEST_TOOL);
    for (const industry of ['retail', 'fashion', 'hotel'])
      expect((await turn(industry)).tools, industry).not.toContain(REQUEST_TOOL);
  });

  it('never offers order tools to a request industry, even with order taking on', async () => {
    for (const industry of ['spa', 'education', 'saas']) {
      const { tools } = await turn(industry, true);
      expect(tools, industry).not.toContain(PREPARE_ORDER_TOOL);
      expect(tools, industry).toContain(REQUEST_TOOL);
    }
    expect((await turn('retail', true)).tools).toContain(PREPARE_ORDER_TOOL);
  });
});
