import { describe, expect, it } from 'vitest';

import {
  BotTurnDetail,
  BotTurnListQuery,
  BotTurnSummary,
  TurnSignal,
  TurnSignalCategory,
  TurnSignalCode,
} from './turn-trace.schema.js';

const RUN = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';

const summary = {
  runId: RUN,
  conversationId: null,
  isTest: false,
  startedAt: '2026-11-02T10:00:00.000Z',
  createdAt: '2026-11-02T10:00:05.000Z',
  outcome: 'fallback',
  guardrail: 'tool_loop_limit',
  tier: 'smart',
  provider: 'fake',
  model: 'fake-1',
  promptVersion: 'sales-agent@15',
  latencyMs: 5000,
  queryExcerpt: 'áo giá bao nhiêu',
  replyExcerpt: null,
  hasTrace: true,
  signals: [{ code: 'tool_loop_limit', category: 'model_limit' }],
};

describe('turn trace contracts', () => {
  it('parses query strings with defaults, booleans and offsets', () => {
    expect(BotTurnListQuery.parse({})).toEqual({ limit: 10 });
    const q = BotTurnListQuery.parse({
      problemsOnly: 'true',
      includeTests: 'false',
      limit: '20',
      around: '2026-11-02T17:00:00+07:00',
      q: '  gia  ',
    });
    expect(q).toMatchObject({ problemsOnly: true, includeTests: false, limit: 20, q: 'gia' });
    expect(BotTurnListQuery.safeParse({ limit: '21' }).success).toBe(false);
    expect(BotTurnListQuery.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(BotTurnListQuery.safeParse({ conversationId: 'nope' }).success).toBe(false);
    expect(BotTurnListQuery.safeParse({ from: 'yesterday' }).success).toBe(false);
  });

  it('accepts a summary and a detail', () => {
    expect(BotTurnSummary.parse(summary).signals).toHaveLength(1);
    const detail = BotTurnDetail.parse({
      ...summary,
      inputTokens: 1,
      cachedTokens: 0,
      outputTokens: 1,
      channel: null,
      commentReply: false,
      historyTurns: 1,
      historySummarized: false,
      customerImages: 0,
      faqHits: [{ faqId: RUN, question: null, score: 0.2, used: false, exists: false }],
      scenarios: [{ id: RUN, title: 'Đổi trả', exists: true }],
      offeredTools: ['send_message'],
      actionIds: [],
      focusProductIds: [],
      pendingAction: false,
      modelCalls: 2,
      loopOutcome: 'limit',
      instructionsChangedSince: null,
      trainingChangedSince: null,
      steps: [
        {
          idx: 0,
          kind: 'model_call',
          toolName: null,
          ok: null,
          errorCode: null,
          ms: 5,
          detail: null,
        },
      ],
    });
    expect(detail.steps).toHaveLength(1);
  });

  it('bounds signal details and knows every code and category', () => {
    expect(
      TurnSignal.safeParse({ code: 'no_trace', category: 'info', detail: 'x'.repeat(201) }).success,
    ).toBe(false);
    expect(TurnSignalCode.options).toContain('fallback_sent');
    expect(TurnSignalCategory.options[0]).toBe('missing_knowledge');
  });
});
