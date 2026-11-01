import {
  FakeLlmProvider,
  type GenerateRequest,
  type GenerateResponse,
  type ToolCall,
} from '@agent-sales/ai-core';
import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { KnowledgeFacade } from '../../knowledge/api/index.js';
import type { BotSaasRequestResult, SaasFacade } from '../../saas/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import type { LlmRuntime } from '../application/llm-runtime.js';
import { PlaygroundService } from '../application/playground.service.js';
import {
  SAAS_REQUEST_NAME,
  SAAS_REQUEST_TOOL,
  contactVouched,
  saasTools,
} from '../application/saas-tools.js';
import { InMemoryAiRunRepository } from '../infrastructure/persistence/ai-run.repositories.js';

const ws = workspaceId(newId());
const botId = newId();

const botOf = (industry: string): BotView =>
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
    orderTaking: false,
  }) as unknown as BotView;

const recorded: BotSaasRequestResult = { outcome: 'recorded', contactId: newId(), created: true };

type Script = (req: GenerateRequest, round: number) => Partial<GenerateResponse>;

function pipeline(script: Script, industry = 'saas') {
  const requests: GenerateRequest[] = [];
  const fake = new FakeLlmProvider('dev-fake', (req: GenerateRequest) => {
    requests.push(req);
    const round = req.messages.filter((m) => m.role === 'assistant' && m.toolCalls?.length).length;
    return { text: '', ...script(req, round) };
  });
  const saas = {
    recordBotRequest: vi.fn(
      async (_ws: unknown, _input: unknown): Promise<BotSaasRequestResult> => recorded,
    ),
  };
  const svc = new PlaygroundService(
    { getBot: async () => botOf(industry) } as BotFacade,
    { searchFaqs: async () => [] } as unknown as KnowledgeFacade,
    { getById: async () => ({ name: 'Shop' }) } as unknown as WorkspaceFacade,
    {
      generate: (req: GenerateRequest) => fake.generate(req, { model: 'echo' }),
    } as unknown as LlmRuntime,
    new InMemoryAiRunRepository(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    saas as SaasFacade,
  );
  return { svc, saas, requests };
}

const call = (input: Record<string, unknown>): Partial<GenerateResponse> => ({
  stopReason: 'tool_use',
  toolCalls: [{ id: 'c-saas', name: SAAS_REQUEST_TOOL, input } as ToolCall],
});
const toolNames = (req: GenerateRequest | undefined) => (req?.tools ?? []).map((t) => t.name);
const lastToolResult = (req: GenerateRequest | undefined) =>
  JSON.stringify(req?.messages.at(-1) ?? null);
const said = 'Mình là Lan, muốn xem demo, sđt 0983 456 721';
const args = { kind: 'demo', name: 'Lan', phone: '0983456721' };
const ask = (text: string) => ({ messages: [{ role: 'customer' as const, content: text }] });
const live = () => ({ conversationId: newId(), isTest: false });

describe('SaaS request tool in the reply pipeline (ADR-020)', () => {
  it('a SaaS bot gets the tool and records the request in-process', async () => {
    const { svc, saas, requests } = pipeline((_req, round) =>
      round === 0 ? call(args) : { text: 'Dạ em đã ghi nhận, bên em sẽ liên hệ chị ạ.' },
    );
    const res = await svc.reply(ws, botId, ask(said), live());
    expect(toolNames(requests[0])).toContain(SAAS_REQUEST_TOOL);
    expect(res.outcome).toBe('answered');
    expect(res.actions).toEqual([{ name: SAAS_REQUEST_NAME, ok: true, statusCode: 200 }]);
    expect(saas.recordBotRequest).toHaveBeenCalledWith(ws, {
      kind: 'demo',
      details: { name: 'Lan', phone: '0983456721' },
      preview: false,
    });
    expect(lastToolResult(requests[1])).toContain('\\"recorded\\":true');
  });

  it('the playground previews without writing', async () => {
    const { svc, saas } = pipeline((_req, round) =>
      round === 0 ? call(args) : { text: 'Dạ em ghi nhận rồi ạ.' },
    );
    await svc.playground(ws, botId, ask(said));
    expect(saas.recordBotRequest.mock.calls[0]?.[1]).toMatchObject({ preview: true });
  });

  it('refuses a phone the customer never wrote', async () => {
    const { svc, saas, requests } = pipeline((_req, round) =>
      round === 0
        ? call({ ...args, phone: '0911222333' })
        : { text: 'Chị cho em xin số điện thoại nhé.' },
    );
    const res = await svc.reply(ws, botId, ask('Mình là Lan, muốn xem demo'), live());
    expect(saas.recordBotRequest).not.toHaveBeenCalled();
    expect(res.actions).toEqual([expect.objectContaining({ ok: false })]);
    expect(lastToolResult(requests[1])).toContain('contact_not_from_customer');
  });

  it('answers a failed write with a retry-later error, never the error text', async () => {
    const { svc, saas, requests } = pipeline((_req, round) =>
      round === 0 ? call(args) : { text: 'Dạ chị thử lại sau ạ.' },
    );
    saas.recordBotRequest.mockRejectedValueOnce(new Error('connection reset'));
    const res = await svc.reply(ws, botId, ask(said), live());
    expect(res.actions).toEqual([expect.objectContaining({ ok: false })]);
    expect(lastToolResult(requests[1])).toContain('not_recorded_retry_later');
    expect(lastToolResult(requests[1])).not.toContain('connection reset');
  });

  it('other industries get no SaaS tool', async () => {
    const { svc, requests } = pipeline(() => ({ text: 'Dạ chào chị.' }), 'fashion');
    await svc.reply(ws, botId, ask(said), live());
    expect(toolNames(requests[0])).not.toContain(SAAS_REQUEST_TOOL);
  });
});

describe('saasTools', () => {
  it('rejects an unknown kind through its schema', () => {
    const { runnable } = saasTools({
      facade: { recordBotRequest: vi.fn() },
      ws,
      isTest: false,
      customerTexts: [said],
      calls: [],
    });
    expect(runnable[0]?.schema.safeParse({ ...args, kind: 'meeting' }).success).toBe(false);
    expect(runnable[0]?.schema.safeParse(args).success).toBe(true);
  });

  it('maps an invalid facade answer to invalid_arguments', async () => {
    const calls: { name: string; ok: boolean; statusCode: number | null }[] = [];
    const { runnable } = saasTools({
      facade: {
        recordBotRequest: async () => ({
          outcome: 'invalid',
          problems: ['phone: not a phone number'],
        }),
      },
      ws,
      isTest: false,
      customerTexts: [said],
      calls,
    });
    const out = await runnable[0]!.run(args);
    expect(out.ok).toBe(false);
    expect(JSON.parse(out.content)).toMatchObject({ error: 'invalid_arguments' });
    expect(calls).toEqual([{ name: SAAS_REQUEST_NAME, ok: false, statusCode: null }]);
  });
});

describe('contactVouched', () => {
  it('vouches contact details only from the customer words', () => {
    expect(contactVouched({ phone: '+84983456721' }, [said])).toBe(true);
    expect(contactVouched({ phone: '0983' }, ['0983'])).toBe(false);
    expect(contactVouched({ email: 'Lan@Example.test' }, ['mail: lan@example.test'])).toBe(true);
    expect(contactVouched({ email: 'x@example.test' }, [said])).toBe(false);
    expect(contactVouched({ email: 'lan@example.test' }, ['lan@example.test.'])).toBe(true);
    expect(contactVouched({ email: 'lan@example.test' }, ['xlan@example.test'])).toBe(false);
    expect(contactVouched({ email: 'lan@example.test' }, ['lan@example.test.vn'])).toBe(false);
    expect(contactVouched({}, [said])).toBe(true);
  });
});
