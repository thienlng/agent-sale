import {
  FakeLlmProvider,
  type GenerateRequest,
  type GenerateResponse,
  type ToolCall,
} from '@agent-sales/ai-core';
import { REQUEST_PROFILES, requestDetailsSchema } from '@agent-sales/contracts';
import { newId, workspaceId } from '@agent-sales/shared';
import { weekdayMismatch } from '../domain/weekday-date.js';
import { describe, expect, it, vi } from 'vitest';

import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { KnowledgeFacade } from '../../knowledge/api/index.js';
import type { BotRequestResult, CrmFacade } from '../../crm/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import type { LlmRuntime } from '../application/llm-runtime.js';
import { PlaygroundService } from '../application/playground.service.js';
import {
  contactVouched,
  REQUEST_TOOL,
  requestInput,
  requestTools,
} from '../application/request-tools.js';
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

const SAAS_REQUEST_NAME = 'Record a demo, free trial or consultation request';
const recorded: BotRequestResult = {
  outcome: 'recorded',
  contactId: newId(),
  phoneE164: '+84983123456',
  created: true,
  missing: [],
  dateLabel: null,
};

type Script = (req: GenerateRequest, round: number) => Partial<GenerateResponse>;

function pipeline(script: Script, industry = 'saas') {
  const requests: GenerateRequest[] = [];
  const fake = new FakeLlmProvider('dev-fake', (req: GenerateRequest) => {
    requests.push(req);
    const round = req.messages.filter((m) => m.role === 'assistant' && m.toolCalls?.length).length;
    return { text: '', ...script(req, round) };
  });
  const crm = {
    recordBotRequest: vi.fn(
      async (_ws: unknown, _input: unknown): Promise<BotRequestResult> => recorded,
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
    crm as unknown as CrmFacade,
  );
  return { svc, crm, requests };
}

const call = (input: Record<string, unknown>): Partial<GenerateResponse> => ({
  stopReason: 'tool_use',
  toolCalls: [{ id: 'c-saas', name: REQUEST_TOOL, input } as ToolCall],
});
const toolNames = (req: GenerateRequest | undefined) => (req?.tools ?? []).map((t) => t.name);
const lastToolResult = (req: GenerateRequest | undefined) =>
  JSON.stringify(req?.messages.at(-1) ?? null);
const said = 'Mình là Lan, muốn xem demo, sđt 0983 456 721';
const args = { kind: 'demo', name: 'Lan', phone: '0983456721' };
const ask = (text: string) => ({ messages: [{ role: 'customer' as const, content: text }] });
const live = () => ({ conversationId: newId(), isTest: false });

describe('record_request in the reply pipeline: saas (ADR-020)', () => {
  it('a SaaS bot gets the tool and records the request in-process', async () => {
    const { svc, crm, requests } = pipeline((_req, round) =>
      round === 0 ? call(args) : { text: 'Dạ em đã ghi nhận, bên em sẽ liên hệ chị ạ.' },
    );
    const res = await svc.reply(ws, botId, ask(said), live());
    expect(toolNames(requests[0])).toContain(REQUEST_TOOL);
    expect(res.outcome).toBe('answered');
    expect(res.actions).toEqual([{ name: SAAS_REQUEST_NAME, ok: true, statusCode: 200 }]);
    expect(crm.recordBotRequest).toHaveBeenCalledWith(ws, {
      kind: 'demo',
      details: { name: 'Lan', phone: '0983456721' },
      preview: false,
      catalogNames: [],
    });
    expect(lastToolResult(requests[1])).toContain('\\"recorded\\":true');
    expect(requests[0]?.tools?.find((t) => t.name === REQUEST_TOOL)?.description).toBe(
      REQUEST_PROFILES.saas.description,
    );
  });

  it('passes the website channel as the source and returns the customer to link (MS-11)', async () => {
    const { svc, crm } = pipeline((_req, round) =>
      round === 0 ? call(args) : { text: 'Dạ em đã ghi nhận ạ.' },
    );
    const res = await svc.reply(ws, botId, ask(said), { ...live(), channel: 'website' });
    expect(crm.recordBotRequest.mock.calls[0]?.[1]).toMatchObject({ channel: 'website' });
    expect(res.requestContact).toEqual({
      contactId: recorded.outcome === 'recorded' ? recorded.contactId : '',
      phoneE164: '+84983123456',
    });
  });

  it('the playground previews without writing', async () => {
    const { svc, crm } = pipeline((_req, round) =>
      round === 0 ? call(args) : { text: 'Dạ em ghi nhận rồi ạ.' },
    );
    await svc.playground(ws, botId, ask(said));
    expect(crm.recordBotRequest.mock.calls[0]?.[1]).toMatchObject({ preview: true });
  });

  it('refuses a phone the customer never wrote', async () => {
    const { svc, crm, requests } = pipeline((_req, round) =>
      round === 0
        ? call({ ...args, phone: '0911222333' })
        : { text: 'Chị cho em xin số điện thoại nhé.' },
    );
    const res = await svc.reply(ws, botId, ask('Mình là Lan, muốn xem demo'), live());
    expect(crm.recordBotRequest).not.toHaveBeenCalled();
    expect(res.actions).toEqual([expect.objectContaining({ ok: false })]);
    expect(lastToolResult(requests[1])).toContain('contact_not_from_customer');
  });

  it('answers a failed write with a retry-later error, never the error text', async () => {
    const { svc, crm, requests } = pipeline((_req, round) =>
      round === 0 ? call(args) : { text: 'Dạ chị thử lại sau ạ.' },
    );
    crm.recordBotRequest.mockRejectedValueOnce(new Error('connection reset'));
    const res = await svc.reply(ws, botId, ask(said), live());
    expect(res.actions).toEqual([expect.objectContaining({ ok: false })]);
    expect(lastToolResult(requests[1])).toContain('not_recorded_retry_later');
    expect(lastToolResult(requests[1])).not.toContain('connection reset');
  });

  it('other industries get no request tool', async () => {
    for (const industry of ['fashion', 'retail', 'hotel']) {
      const { svc, requests } = pipeline(() => ({ text: 'Dạ chào chị.' }), industry);
      await svc.reply(ws, botId, ask(said), live());
      expect(toolNames(requests[0]), industry).not.toContain(REQUEST_TOOL);
    }
  });
});

describe('record_request for education and spa', () => {
  const booked = 'Mình là Hoa, đặt lịch gội đầu dưỡng sinh chiều thứ 7, sđt 0983 456 721';
  const spaArgs = {
    kind: 'appointment',
    name: 'Hoa',
    phone: '0983456721',
    service: 'Gội đầu dưỡng sinh',
    preferredDate: '2027-11-13',
    preferredTime: 'chiều',
  };

  it('a spa bot records an appointment with the spa profile; an update passes no missing details again (LM-13)', async () => {
    const { svc, crm, requests } = pipeline(
      (_req, round) => (round === 0 ? call(spaArgs) : { text: 'Dạ em đã ghi nhận ạ.' }),
      'spa',
    );
    crm.recordBotRequest.mockResolvedValueOnce({
      outcome: 'updated',
      contactId: newId(),
      phoneE164: '+84983123456',
      created: false,
      missing: ['branch'],
      dateLabel: 'Thứ Bảy 13/11/2027',
    });
    const res = await svc.reply(ws, botId, ask(booked), live());
    const tool = requests[0]?.tools?.find((t) => t.name === REQUEST_TOOL);
    expect(tool?.description).toBe(REQUEST_PROFILES.spa.description);
    expect(res.actions).toEqual([
      { name: REQUEST_PROFILES.spa.actionName, ok: true, statusCode: 200 },
    ]);
    expect(crm.recordBotRequest).toHaveBeenCalledWith(ws, {
      kind: 'appointment',
      details: {
        name: 'Hoa',
        phone: '0983456721',
        service: 'Gội đầu dưỡng sinh',
        preferredDate: '2027-11-13',
        preferredTime: 'chiều',
      },
      preview: false,
      catalogNames: [],
    });
    const result = lastToolResult(requests[1]);
    expect(result).toContain('\\"updated\\":true');
    // LM-13: they were asked for when the request was first recorded.
    expect(result).toContain('\\"missing\\":[]');
    expect(result).toContain('Thứ Bảy 13/11/2027');
  });

  it('an education bot gets the education profile; the playground previews', async () => {
    const { svc, crm, requests } = pipeline(
      (_req, round) =>
        round === 0
          ? call({ kind: 'placement_test', name: 'Lan', phone: '0983456721', studentAge: '8' })
          : { text: 'Dạ em ghi nhận rồi ạ.' },
      'education',
    );
    crm.recordBotRequest.mockResolvedValueOnce({
      outcome: 'preview',
      missing: ['course', 'branch'],
      dateLabel: null,
    });
    const res = await svc.playground(ws, botId, ask(said));
    expect(toolNames(requests[0])).toContain(REQUEST_TOOL);
    expect(crm.recordBotRequest.mock.calls[0]?.[1]).toMatchObject({
      kind: 'placement_test',
      preview: true,
    });
    expect(res.actions).toEqual([
      { name: REQUEST_PROFILES.education.actionName, ok: true, statusCode: 200 },
    ]);
    const result = lastToolResult(requests[1]);
    expect(result).toContain('\\"updated\\":false');
    expect(result).toContain('\\"dateLabel\\":null');
  });

  it('limits kind to the profile kinds and offers exactly the profile fields', () => {
    for (const industry of ['saas', 'education', 'spa'] as const) {
      const profile = REQUEST_PROFILES[industry];
      const schema = requestInput(profile);
      expect(Object.keys(schema.shape)).toEqual([
        'kind',
        ...Object.keys(requestDetailsSchema(industry).shape),
      ]);
      for (const kind of profile.kinds)
        expect(schema.safeParse({ kind }).success, `${industry} ${kind}`).toBe(true);
    }
    expect(requestInput(REQUEST_PROFILES.spa).safeParse({ kind: 'demo' }).success).toBe(false);
    expect(requestInput(REQUEST_PROFILES.saas).safeParse({ kind: 'appointment' }).success).toBe(
      false,
    );
    expect(
      requestInput(REQUEST_PROFILES.education).safeParse({ kind: 'placement_test', guests: '2' })
        .data,
    ).not.toHaveProperty('guests');
  });
});

describe('requestTools', () => {
  it('rejects an unknown kind through its schema', () => {
    const { runnable } = requestTools({
      facade: { recordBotRequest: vi.fn() },
      ws,
      profile: REQUEST_PROFILES.saas,
      isTest: false,
      customerTexts: [said],
      calls: [],
    });
    expect(runnable[0]?.schema.safeParse({ ...args, kind: 'meeting' }).success).toBe(false);
    expect(runnable[0]?.schema.safeParse(args).success).toBe(true);
  });

  it('maps an invalid facade answer to invalid_arguments', async () => {
    const calls: { name: string; ok: boolean; statusCode: number | null }[] = [];
    const { runnable } = requestTools({
      facade: {
        recordBotRequest: async () => ({
          outcome: 'invalid',
          problems: ['phone: not a phone number'],
        }),
      },
      ws,
      profile: REQUEST_PROFILES.saas,
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

  it('passes the names of the products seen so far, read at call time (T-187)', async () => {
    const recordBotRequest = vi.fn(async (_ws: unknown, _input: unknown) => recorded);
    const seen: string[] = [];
    const { runnable } = requestTools({
      facade: { recordBotRequest },
      ws,
      profile: REQUEST_PROFILES.saas,
      isTest: false,
      customerTexts: [said],
      calls: [],
      catalogNames: () => seen,
    });
    seen.push('Gói Pro');
    await runnable[0]!.run(args);
    expect(recordBotRequest.mock.calls[0]?.[1]).toMatchObject({ catalogNames: ['Gói Pro'] });
  });
});

describe('weekdayMismatch (LM-17, LM2-6)', () => {
  it('flags a weekday and a date that disagree in the newest message, whichever was resolved', () => {
    const texts = ['chiều thứ 7 ngày 15/11/2027 lúc 4h'];
    expect(weekdayMismatch('2027-11-15', texts)).toBe('15/11 là Thứ Hai');
    // LM2-6: the model resolved the weekday (Saturday 14/11) instead of the date.
    expect(weekdayMismatch('2026-11-14', ['Chiều thứ 7 tuần này 15/11 lúc 4h chiều nhé'])).toBe(
      '15/11 là Chủ Nhật',
    );
    expect(weekdayMismatch('2027-11-13', ['thứ 7 13/11/2027'])).toBeNull();
    expect(weekdayMismatch('2026-11-15', ['chủ nhật 15/11'])).toBeNull();
    expect(weekdayMismatch('2027-11-15', ['ngày 15/11/2027'])).toBeNull();
    // The customer's answer ends it: only the newest message counts.
    expect(weekdayMismatch('2026-11-14', ['thứ 7 tuần này 15/11', 'thứ 7 nhé em'])).toBeNull();
  });
});
