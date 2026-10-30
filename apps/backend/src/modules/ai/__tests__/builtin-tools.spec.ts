import { FakeLlmProvider, type GenerateRequest, type LlmProvider } from '@agent-sales/ai-core';
import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { KnowledgeFacade } from '../../knowledge/api/index.js';
import type { BotSaasRequestResult, SaasFacade } from '../../saas/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import { SAAS_REQUEST_TOOL, contactVouched } from '../application/builtin-tools.js';
import { LlmRuntime } from '../application/llm-runtime.js';
import { PlaygroundService } from '../application/playground.service.js';
import type { LlmProviderFactory } from '../application/ports/llm-provider-factory.js';
import { InMemoryAiRunRepository } from '../infrastructure/persistence/ai-run.repositories.js';
import { InMemoryLlmConfigRepository } from '../infrastructure/persistence/llm-config.in-memory-repository.js';

const ws = workspaceId(newId());
const botId = newId();
const botOf = (industry: string) =>
  ({
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
    industry,
    profile: { fields: {}, notes: '' },
  }) as unknown as BotView;

const recorded: BotSaasRequestResult = { outcome: 'recorded', contactId: newId(), created: true };

function build(script: object[], industry = 'saas', result = recorded) {
  const queue = [...script];
  const requests: GenerateRequest[] = [];
  const fake = new FakeLlmProvider('dev-fake', (req) => {
    requests.push(req);
    const next = queue.shift();
    return next === undefined ? new Error('script exhausted') : { text: JSON.stringify(next) };
  });
  const factory: LlmProviderFactory = {
    create: () => fake as LlmProvider,
    hermesLogin: () => {
      throw new Error('unused');
    },
    listModels: () => Promise.resolve({ models: [], state: 'unavailable' }),
    developmentFallback: () => ({ provider: fake, model: 'echo' }),
  };
  const saas = { recordBotRequest: vi.fn(async () => result) } as SaasFacade & {
    recordBotRequest: ReturnType<typeof vi.fn>;
  };
  const svc = new PlaygroundService(
    { getBot: async () => botOf(industry) } as BotFacade,
    { searchFaqs: async () => [] } as unknown as KnowledgeFacade,
    { getById: async () => ({ name: 'Shop' }) } as unknown as WorkspaceFacade,
    new LlmRuntime(new InMemoryLlmConfigRepository(), factory),
    new InMemoryAiRunRepository(),
    undefined,
    undefined,
    undefined,
    undefined,
    saas,
  );
  return { svc, saas, requests };
}

const call = (args: object) => ({
  outcome: 'call_action',
  reply: '',
  sources: [],
  actionId: SAAS_REQUEST_TOOL,
  args,
});
const answer = (reply: string) => ({ outcome: 'answer', reply, sources: [] });
const said = 'Mình là Lan, muốn xem demo, sđt 0983 456 721';
const args = { kind: 'demo', name: 'Lan', phone: '0983456721' };

describe('SaaS built-in request tool', () => {
  it('a SaaS bot sees the tool and records the request in-process', async () => {
    const { svc, saas, requests } = build([
      call(args),
      answer('Dạ em đã ghi nhận, bên em sẽ liên hệ chị ạ.'),
    ]);
    const res = await svc.reply(
      ws,
      botId,
      { messages: [{ role: 'customer', content: said }] },
      { conversationId: newId(), isTest: false },
    );
    expect(res.outcome).toBe('answered');
    expect(res.actions).toEqual([
      { name: 'Record a demo, free trial or consultation request', ok: true, statusCode: 200 },
    ]);
    expect(saas.recordBotRequest).toHaveBeenCalledWith(ws, {
      kind: 'demo',
      details: { name: 'Lan', phone: '0983456721' },
      preview: false,
    });
    expect(JSON.stringify(requests[0]?.messages)).toContain(SAAS_REQUEST_TOOL);
    expect(requests[1]?.messages.at(-1)?.content).toContain('"recorded":true');
  });

  it('the playground previews without writing', async () => {
    const { svc, saas } = build([call(args), answer('Dạ em ghi nhận rồi ạ.')]);
    await svc.playground(ws, botId, { messages: [{ role: 'customer', content: said }] });
    expect(saas.recordBotRequest.mock.calls[0]?.[1]).toMatchObject({ preview: true });
  });

  it('refuses a phone or email the customer never wrote', async () => {
    const { svc, saas, requests } = build([
      call({ ...args, phone: '0911222333' }),
      answer('Chị cho em xin số điện thoại nhé.'),
    ]);
    const res = await svc.reply(
      ws,
      botId,
      { messages: [{ role: 'customer', content: 'Mình là Lan, muốn xem demo' }] },
      { conversationId: newId(), isTest: false },
    );
    expect(saas.recordBotRequest).not.toHaveBeenCalled();
    expect(res.actions).toEqual([expect.objectContaining({ ok: false })]);
    expect(requests[1]?.messages.at(-1)?.content).toContain('invalid_args');
  });

  it('answers a failed write with a retryable error code', async () => {
    const { svc, saas, requests } = build([call(args), answer('Dạ chị thử lại sau ạ.')]);
    saas.recordBotRequest.mockRejectedValueOnce(new Error('connection reset'));
    const res = await svc.reply(
      ws,
      botId,
      { messages: [{ role: 'customer', content: said }] },
      { conversationId: newId(), isTest: false },
    );
    expect(res.actions).toEqual([expect.objectContaining({ ok: false })]);
    expect(requests[1]?.messages.at(-1)?.content).toContain('"errorCode":"network"');
  });

  it('other industries get no built-in tool', async () => {
    const { svc, requests } = build([answer('Dạ chào chị.')], 'fashion');
    await svc.reply(
      ws,
      botId,
      { messages: [{ role: 'customer', content: said }] },
      { conversationId: newId(), isTest: false },
    );
    expect(JSON.stringify(requests[0]?.messages)).not.toContain(SAAS_REQUEST_TOOL);
  });

  it('vouches contact details only from the customer words', () => {
    expect(contactVouched({ phone: '+84983456721' }, [said])).toBe(true);
    expect(contactVouched({ phone: '0983' }, ['0983'])).toBe(false);
    expect(contactVouched({ email: 'Lan@Example.test' }, ['mail: lan@example.test'])).toBe(true);
    expect(contactVouched({ email: 'x@example.test' }, [said])).toBe(false);
    expect(contactVouched({ email: 'lan@example.test' }, ['lan@example.test.'])).toBe(true);
    expect(contactVouched({ email: 'lan@example.test' }, ['xlan@example.test'])).toBe(false);
    expect(contactVouched({ email: 'lan@example.test' }, ['lan@example.test.vn'])).toBe(false);
    expect(contactVouched({ name: 'Lan' }, [said])).toBe(true);
  });
});
