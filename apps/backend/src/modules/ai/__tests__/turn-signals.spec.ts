import { TurnSignalCode } from '@agent-sales/contracts';
import { newId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import type { AiRunRecord } from '../domain/ports/ai-run.repository.js';
import type { TurnStepRecord, TurnTraceRecord } from '../domain/ports/turn-trace.repository.js';
import { isProblemTurn, MAX_SIGNALS, turnSignals } from '../domain/turn-signals.js';
import { runRecord, traceRecord } from './factories/turn-trace.factory.js';

const ctx = { botTier: 'smart', instructionsChangedSince: false, trainingChangedSince: false };
const goodHit = [{ faqId: newId(), score: 0.9, used: true }];

function signalsOf(
  run: Partial<AiRunRecord> = {},
  trace: Partial<TurnTraceRecord> | null = {},
  steps: Partial<TurnStepRecord>[] = [],
  context: Partial<typeof ctx> = {},
) {
  const r = runRecord({ retrieved: goodHit, ...run });
  return turnSignals(
    {
      run: r,
      trace: trace ? traceRecord(r, trace) : null,
      steps: steps.map((s, idx) => ({
        idx,
        kind: 'tool',
        toolName: null,
        ok: true,
        errorCode: null,
        ms: 1,
        detail: null,
        ...s,
      })),
    },
    { ...ctx, ...context },
  );
}
const codes = (...args: Parameters<typeof signalsOf>) => signalsOf(...args).map((s) => s.code);

describe('turnSignals', () => {
  it('a clean answered turn has no signal', () => {
    expect(signalsOf()).toEqual([]);
  });

  it('missing knowledge', () => {
    expect(codes({ retrieved: [] })).toEqual(['no_faq_hits']);
    expect(signalsOf({ retrieved: [{ faqId: newId(), score: 0.2, used: true }] })).toEqual([
      { code: 'faq_low_score', category: 'missing_knowledge', detail: '0.20' },
    ]);
    expect(codes({ retrieved: [{ faqId: newId(), score: 0.8, used: false }] })).toEqual([
      'faq_not_used',
    ]);
    expect(
      codes({}, {}, [{ toolName: 'search_products', detail: { resultCount: 0, productIds: [] } }]),
    ).toEqual(['product_search_empty']);
  });

  it('instructions', () => {
    expect(codes({}, {}, [], { instructionsChangedSince: true })).toEqual([
      'instructions_changed_since',
    ]);
    expect(codes({}, {}, [], { trainingChangedSince: true })).toEqual(['training_changed_since']);
    expect(codes({ outcome: 'handoff' })).toEqual(['handoff']);
  });

  it('product data from product_details', () => {
    const steps = [
      {
        toolName: 'product_details',
        detail: {
          productIds: ['a'],
          missing: [{ productId: 'a', fields: ['price', 'stock', 'description', 'images'] }],
        },
      },
    ];
    expect(signalsOf({}, {}, steps)).toEqual([
      { code: 'product_price_missing', category: 'product_data', detail: 'a' },
      { code: 'product_out_of_stock', category: 'product_data', detail: 'a' },
      { code: 'product_description_missing', category: 'product_data', detail: 'a' },
      { code: 'product_images_missing', category: 'product_data', detail: 'a' },
    ]);
  });

  it('tool failures', () => {
    expect(
      signalsOf({}, {}, [{ toolName: 'calculate', ok: false, errorCode: 'invalid_expression' }]),
    ).toEqual([
      { code: 'tool_failed', category: 'tool_failure', detail: 'calculate:invalid_expression' },
    ]);
    expect(
      signalsOf({}, {}, [
        {
          toolName: 'action_1',
          ok: true,
          errorCode: 'http_4xx',
          detail: { actionId: 'act-1', statusCode: 401, errorCode: 'http_4xx' },
        },
      ]),
    ).toEqual([{ code: 'action_failed', category: 'tool_failure', detail: 'act-1:http_4xx:401' }]);
    expect(codes({ outcome: 'fallback', guardrail: 'action_loop_limit' })).toEqual([
      'action_loop_limit',
      'fallback_sent',
    ]);
  });

  it('model limits', () => {
    expect(
      codes({ outcome: 'fallback', guardrail: 'model_error' }, { loopOutcome: 'error' }),
    ).toEqual(['model_error', 'fallback_sent']);
    expect(codes({ outcome: 'fallback', guardrail: 'output_truncated' })).toEqual([
      'output_truncated',
      'fallback_sent',
    ]);
    expect(codes({}, { loopOutcome: 'budget' })).toEqual(['budget']);
    expect(codes({}, { loopOutcome: 'limit' })).toEqual(['tool_loop_limit']);
    expect(codes({}, { loopOutcome: 'invalid_tools' })).toEqual(['invalid_tools']);
    expect(codes({}, { historySummarized: true })).toEqual(['history_summarized']);
    expect(codes({ tier: 'basic' })).toEqual(['basic_tier']);
  });

  it('channel', () => {
    expect(codes({}, { messagesUndelivered: 1 })).toEqual(['not_delivered']);
    expect(
      codes({}, {}, [{ toolName: 'send_message', ok: false, detail: { delivered: false } }]),
    ).toEqual(['not_delivered']);
    expect(
      codes({ outcome: 'fallback', guardrail: 'interrupted' }, { loopOutcome: 'interrupted' }),
    ).toEqual(['interrupted']);
    expect(codes({}, { commentReply: true })).toEqual(['comment_reply']);
  });

  it('guardrails', () => {
    expect(codes({ outcome: 'handoff', guardrail: 'provider_refusal' })).toEqual([
      'provider_refusal',
    ]);
    expect(signalsOf({ outcome: 'fallback' })).toEqual([
      { code: 'fallback_sent', category: 'guardrail' },
    ]);
  });

  it('info: a run without trace', () => {
    expect(codes({}, null)).toEqual(['no_trace']);
  });

  it('covers every code of the contract', () => {
    const seen = new Set<string>([
      ...codes({ retrieved: [] }),
      'faq_low_score',
      'faq_not_used',
      'product_search_empty',
      'instructions_changed_since',
      'training_changed_since',
      'handoff',
      'product_price_missing',
      'product_out_of_stock',
      'product_description_missing',
      'product_images_missing',
      'tool_failed',
      'action_failed',
      'action_loop_limit',
      'model_error',
      'output_truncated',
      'budget',
      'tool_loop_limit',
      'invalid_tools',
      'history_summarized',
      'basic_tier',
      'not_delivered',
      'interrupted',
      'comment_reply',
      'provider_refusal',
      'fallback_sent',
      'no_trace',
    ]);
    expect([...seen].sort()).toEqual([...TurnSignalCode.options].sort());
  });

  it('orders by category then code, deduplicates and caps at 20', () => {
    const steps = Array.from({ length: 30 }, (_, i) => ({
      toolName: 'calculate',
      ok: false,
      errorCode: `e${String(i).padStart(2, '0')}`,
    }));
    const out = signalsOf({ retrieved: [], outcome: 'fallback', guardrail: 'budget' }, {}, [
      ...steps,
      ...steps,
    ]);
    expect(out).toHaveLength(MAX_SIGNALS);
    expect(out[0]?.code).toBe('no_faq_hits');
    expect(new Set(out.map((s) => `${s.code}${s.detail}`)).size).toBe(out.length);
  });

  it('problem turns', () => {
    const r = runRecord({ retrieved: goodHit });
    expect(isProblemTurn({ run: r, trace: null }, [])).toBe(false);
    expect(isProblemTurn({ run: { ...r, outcome: 'fallback' }, trace: null }, [])).toBe(true);
    expect(isProblemTurn({ run: r, trace: null }, [{ code: 'no_trace', category: 'info' }])).toBe(
      false,
    );
  });
});
