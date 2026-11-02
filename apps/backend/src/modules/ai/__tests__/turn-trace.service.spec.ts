import { FakeLlmProvider, type GenerateRequest } from '@agent-sales/ai-core';
import { BotTurnDetail, BotTurnList, BotTurnListQuery } from '@agent-sales/contracts';
import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { KnowledgeFacade, TrainingFacade } from '../../knowledge/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import { AiTraceRunnerImpl } from '../application/ai-trace.runner.js';
import type { LlmRuntime } from '../application/llm-runtime.js';
import { PlaygroundService } from '../application/playground.service.js';
import {
  decodeTurnCursor,
  encodeTurnCursor,
  TurnTraceService,
} from '../application/turn-trace.service.js';
import { InMemoryAiRunRepository } from '../infrastructure/persistence/ai-run.repositories.js';
import { InMemoryTurnTraceRepository } from '../infrastructure/persistence/turn-trace.repositories.js';
import { runRecord, traceRecord } from './factories/turn-trace.factory.js';

const DAY = 86_400_000;
const ws = workspaceId(newId());
const botId = newId();
const faqId = newId();

function setup() {
  let bot = {
    id: botId,
    name: 'Bot',
    isActive: true,
    mission: 'Bán áo',
    greeting: '',
    selfPronoun: 'em',
    customerPronoun: 'anh/chị',
    fallbackMessage: 'fallback',
    handoffMessage: 'Dạ em chuyển nhân viên ạ.',
    creativity: 'balanced',
    modelTier: 'smart',
    language: 'vi',
    placeholders: {},
    industry: 'retail',
    catalogMode: 'all',
    profile: { fields: {}, notes: '' },
    replyLength: 'short',
    tone: 'friendly',
    allowEmoji: false,
  } as unknown as BotView;
  const bots = {
    getBot: async (_ws: unknown, id: string) => {
      if (id !== botId) throw Object.assign(new Error('Bot not found'), { code: 'NOT_FOUND' });
      return bot;
    },
  } as unknown as BotFacade;
  const scenarioId = newId();
  let scenarioContent = 'Hỏi mã đơn.';
  const training = {
    list: async () => [
      {
        id: scenarioId,
        botId,
        kind: 'scenario',
        title: 'Đổi trả',
        content: scenarioContent,
        trigger: null,
        enabled: true,
        section: 'general',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  } as unknown as TrainingFacade;
  const knowledge = {
    searchFaqs: async () => [
      {
        id: faqId,
        botId,
        question: 'Phí ship?',
        answer: '30k',
        source: 'manual',
        updatedAt: new Date(),
        score: 0.2,
      },
    ],
    listFaqs: async () => [{ id: faqId, botId, question: 'Phí ship?', answer: '30k' }],
  } as unknown as KnowledgeFacade;
  const workspaces = { getById: async () => ({ name: 'Shop' }) } as unknown as WorkspaceFacade;
  const runs = new InMemoryAiRunRepository();
  const traces = new InMemoryTurnTraceRepository(runs);
  const fake = new FakeLlmProvider('dev-fake', () => ({ text: 'Dạ phí ship 30k ạ' }));
  const llm = {
    generate: (req: GenerateRequest) => fake.generate(req, { model: 'echo' }),
  } as unknown as LlmRuntime;
  const playground = new PlaygroundService(
    bots,
    knowledge,
    workspaces,
    llm,
    runs,
    training,
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
    traces,
  );
  const service = new TurnTraceService(traces, bots, workspaces, knowledge, training);
  return {
    runs,
    traces,
    playground,
    service,
    scenarioId,
    setMission: (mission: string) => {
      bot = { ...bot, mission };
    },
    setScenario: (content: string) => {
      scenarioContent = content;
    },
  };
}

const query = (q: Record<string, unknown> = {}) => BotTurnListQuery.parse(q);

describe('TurnTraceService', () => {
  it('lists a traced turn and returns its detail with today’s FAQ text and scenarios', async () => {
    const t = setup();
    const res = await t.playground.reply(
      ws,
      botId,
      {
        messages: [{ role: 'customer', content: 'phí ship giá bao nhiêu' }],
      },
      { conversationId: newId(), isTest: false },
    );
    const list = BotTurnList.parse(await t.service.list(ws, botId, query()));
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ runId: res.runId, hasTrace: true });
    expect(list.items[0]?.signals.map((s) => s.code)).toEqual(['faq_low_score']);
    const detail = BotTurnDetail.parse(await t.service.get(ws, botId, res.runId));
    expect(detail.faqHits).toEqual([
      { faqId, question: 'Phí ship?', score: 0.2, used: true, exists: true },
    ]);
    expect(detail.scenarios).toEqual([{ id: t.scenarioId, title: 'Đổi trả', exists: true }]);
    expect(detail.instructionsChangedSince).toBe(false);
    expect(detail.trainingChangedSince).toBe(false);
    expect(detail.steps.map((s) => s.kind)).toEqual(['model_call']);
  });

  it('says the instructions and training changed since the turn', async () => {
    const t = setup();
    const res = await t.playground.playground(ws, botId, {
      messages: [{ role: 'customer', content: 'hi' }],
    });
    t.setMission('Bán giày');
    t.setScenario('Hỏi số điện thoại.');
    const detail = await t.service.get(ws, botId, res.runId);
    expect(detail.instructionsChangedSince).toBe(true);
    expect(detail.trainingChangedSince).toBe(true);
    expect(detail.signals.map((s) => s.code)).toEqual(
      expect.arrayContaining(['instructions_changed_since', 'training_changed_since']),
    );
  });

  it('flags a run without trace with no_trace and nulls', async () => {
    const t = setup();
    const run = runRecord({ botId, createdAt: new Date(Date.now() - DAY) });
    await t.runs.record(ws, run);
    const detail = await t.service.get(ws, botId, run.id);
    expect(detail).toMatchObject({
      hasTrace: false,
      startedAt: null,
      instructionsChangedSince: null,
      trainingChangedSince: null,
      steps: [],
    });
    expect(detail.signals.map((s) => s.code)).toContain('no_trace');
  });

  it('404s another bot, a malformed id and an unknown run', async () => {
    const t = setup();
    const run = runRecord({ botId });
    await t.runs.record(ws, run);
    await expect(t.service.get(ws, botId, newId())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(t.service.get(ws, botId, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(t.service.get(ws, newId(), run.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(t.service.get(workspaceId(newId()), botId, run.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('clamps the window to the last 30 days, 7 by default', async () => {
    const t = setup();
    const at = (days: number) => runRecord({ botId, createdAt: new Date(Date.now() - days * DAY) });
    const conversationId = newId();
    const [d40, d10, d1] = [at(40), { ...at(10), conversationId }, at(1)];
    for (const r of [d40, d10, d1]) await t.runs.record(ws, r);
    const ids = async (q: Record<string, unknown>) =>
      (await t.service.list(ws, botId, query(q))).items.map((i) => i.runId);
    expect(await ids({})).toEqual([d1.id]);
    expect(await ids({ from: new Date(Date.now() - 60 * DAY).toISOString() })).toEqual([
      d1.id,
      d10.id,
    ]);
    expect(await ids({ conversationId })).toEqual([d10.id]);
    expect(await ids({ to: new Date(Date.now() + 5 * DAY).toISOString() })).toEqual([d1.id]);
    expect(await ids({ from: new Date(Date.now() + DAY).toISOString() })).toEqual([]);
  });

  it('pages with a cursor and filters problems after the signals', async () => {
    const t = setup();
    const t0 = Date.now() - DAY;
    const rows = Array.from({ length: 5 }, (_, i) =>
      runRecord({
        botId,
        createdAt: new Date(t0 + i * 1000),
        retrieved: [{ faqId, score: 0.9, used: true }],
        outcome: i % 2 === 0 ? 'fallback' : 'answered',
      }),
    );
    for (const r of rows) {
      await t.runs.record(ws, r);
      await t.traces.record(ws, traceRecord(r), []);
    }
    const page1 = await t.service.list(ws, botId, query({ limit: '2' }));
    expect(page1.items.map((i) => i.runId)).toEqual([rows[4]?.id, rows[3]?.id]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await t.service.list(
      ws,
      botId,
      query({ limit: '2', cursor: page1.nextCursor ?? '' }),
    );
    expect(page2.items.map((i) => i.runId)).toEqual([rows[2]?.id, rows[1]?.id]);
    const page3 = await t.service.list(
      ws,
      botId,
      query({ limit: '2', cursor: page2.nextCursor ?? '' }),
    );
    expect(page3).toEqual({
      items: [expect.objectContaining({ runId: rows[0]?.id })],
      nextCursor: null,
    });

    const problems = await t.service.list(ws, botId, query({ problemsOnly: 'true', limit: '2' }));
    expect(problems.items.map((i) => i.runId)).toEqual([rows[4]?.id, rows[2]?.id]);
    const rest = await t.service.list(
      ws,
      botId,
      query({ problemsOnly: 'true', limit: '2', cursor: problems.nextCursor ?? '' }),
    );
    expect(rest.items.map((i) => i.runId)).toEqual([rows[0]?.id]);
  });

  it('round-trips and rejects cursors', () => {
    const row = { createdAt: new Date('2026-11-02T10:00:00.123Z'), id: newId() };
    expect(decodeTurnCursor(encodeTurnCursor(row))).toEqual({
      createdAt: row.createdAt,
      runId: row.id,
    });
    expect(() => decodeTurnCursor('garbage')).toThrow();
  });
});

describe('AiTraceRunnerImpl', () => {
  it('purges in batches until one comes back short', async () => {
    const calls: [Date, number][] = [];
    const answers = [5_000, 5_000, 12];
    const repo = {
      purgeExpired: async (before: Date, batch: number) => {
        calls.push([before, batch]);
        return answers.shift() ?? 0;
      },
    } as unknown as InMemoryTurnTraceRepository;
    const now = new Date('2026-11-02T00:00:00.000Z');
    expect(await new AiTraceRunnerImpl(repo).purgeExpired(now)).toBe(10_012);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual([new Date('2026-10-03T00:00:00.000Z'), 5_000]);

    let clock = Date.now() - 31 * DAY;
    const runs = new InMemoryAiRunRepository();
    const memory = new InMemoryTurnTraceRepository(runs, () => new Date(clock));
    const old = runRecord({ botId });
    await runs.record(ws, old);
    await memory.record(ws, traceRecord(old), []);
    clock = Date.now();
    const fresh = runRecord({ botId });
    await runs.record(ws, fresh);
    await memory.record(ws, traceRecord(fresh), []);
    expect(await new AiTraceRunnerImpl(memory).purgeExpired()).toBe(1);
    expect(memory.traces.map((x) => x.trace.runId)).toEqual([fresh.id]);
  });

  it('stops after 20 batches', async () => {
    let n = 0;
    const repo = {
      purgeExpired: async () => {
        n += 1;
        return 5_000;
      },
    } as unknown as InMemoryTurnTraceRepository;
    expect(await new AiTraceRunnerImpl(repo).purgeExpired()).toBe(100_000);
    expect(n).toBe(20);
  });
});
