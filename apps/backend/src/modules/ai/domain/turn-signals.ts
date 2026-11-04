import {
  TurnSignalCategory,
  TurnSignalCode,
  type TurnSignal,
  type TurnSignalCategory as Category,
  type TurnSignalCode as Code,
} from '@agent-sales/contracts';

import type { TurnRow, TurnStepRecord } from './ports/turn-trace.repository.js';

/**
 * Deterministic hints of what went wrong in a shop-bot turn (spec 2026-11-02-owner-assistant-doctor
 * §5.2). Evidence, not the verdict: the owner assistant reads the content and decides. Pure.
 */

/** Best FAQ score below this raises `faq_low_score` (tuned later from data). */
export const FAQ_LOW_SCORE = 0.35;
export const MAX_SIGNALS = 20;
const MAX_DETAIL = 200;

export const SIGNAL_CATEGORY: Record<Code, Category> = {
  no_faq_hits: 'missing_knowledge',
  faq_low_score: 'missing_knowledge',
  faq_not_used: 'missing_knowledge',
  product_search_empty: 'missing_knowledge',
  instructions_changed_since: 'instructions',
  training_changed_since: 'instructions',
  handoff: 'instructions',
  product_price_missing: 'product_data',
  product_out_of_stock: 'product_data',
  product_description_missing: 'product_data',
  product_images_missing: 'product_data',
  tool_failed: 'tool_failure',
  action_failed: 'tool_failure',
  action_loop_limit: 'tool_failure',
  model_error: 'model_limit',
  output_truncated: 'model_limit',
  budget: 'model_limit',
  tool_loop_limit: 'model_limit',
  invalid_tools: 'model_limit',
  history_summarized: 'model_limit',
  basic_tier: 'model_limit',
  not_delivered: 'channel',
  interrupted: 'channel',
  comment_reply: 'channel',
  provider_refusal: 'guardrail',
  fallback_sent: 'guardrail',
  no_trace: 'info',
};

const MISSING_FIELD_CODE: Record<string, Code> = {
  price: 'product_price_missing',
  stock: 'product_out_of_stock',
  description: 'product_description_missing',
  images: 'product_images_missing',
};

export interface TurnSignalContext {
  botTier: string;
  instructionsChangedSince: boolean | null;
  trainingChangedSince: boolean | null;
}

const isActionTool = (name: string | null): boolean =>
  !!name &&
  (name.startsWith('action_') ||
    name === 'confirm_pending_action' ||
    name === 'cancel_pending_action');

const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function stepSignals(steps: readonly TurnStepRecord[], add: (c: Code, d?: string) => void): void {
  for (const step of steps) {
    if (step.kind !== 'tool') continue;
    const detail = rec(step.detail);
    const name = step.toolName;
    if (name === 'search_products' && detail.resultCount === 0) add('product_search_empty');
    if (name === 'product_details') {
      for (const item of Array.isArray(detail.missing) ? detail.missing : []) {
        const { productId, fields } = rec(item);
        for (const field of Array.isArray(fields) ? fields : []) {
          const code = MISSING_FIELD_CODE[String(field)];
          if (code) add(code, typeof productId === 'string' ? productId : undefined);
        }
      }
    }
    if (name === 'send_message') {
      if (detail.delivered === false) add('not_delivered');
      continue;
    }
    const failed = step.ok === false || step.errorCode !== null;
    if (!failed) continue;
    const code = step.errorCode ?? 'failed';
    if (isActionTool(name)) {
      const actionId = typeof detail.actionId === 'string' ? detail.actionId : '?';
      const status = typeof detail.statusCode === 'number' ? String(detail.statusCode) : '-';
      add('action_failed', `${actionId}:${code}:${status}`);
    } else {
      add('tool_failed', `${name ?? 'unknown'}:${code}`);
    }
  }
}

/** The signals of one turn: ordered by category, then code; deduplicated; at most 20. */
export function turnSignals(
  row: TurnRow & { steps?: readonly TurnStepRecord[] },
  ctx: TurnSignalContext,
): TurnSignal[] {
  const out = new Map<string, TurnSignal>();
  const add = (code: Code, detail?: string): void => {
    const cut = detail?.slice(0, MAX_DETAIL);
    const key = `${code}|${cut ?? ''}`;
    if (!out.has(key))
      out.set(key, { code, category: SIGNAL_CATEGORY[code], ...(cut ? { detail: cut } : {}) });
  };
  const { run, trace } = row;
  const guardrail = run.guardrail;
  const loop = trace?.loopOutcome ?? null;

  if (run.retrieved.length === 0) add('no_faq_hits');
  else {
    const best = Math.max(...run.retrieved.map((r) => r.score));
    if (best < FAQ_LOW_SCORE) add('faq_low_score', best.toFixed(2));
    if (!run.retrieved.some((r) => r.used)) add('faq_not_used');
  }

  if (ctx.instructionsChangedSince) add('instructions_changed_since');
  if (ctx.trainingChangedSince) add('training_changed_since');
  if (run.outcome === 'handoff' && guardrail !== 'provider_refusal') add('handoff');

  stepSignals(row.steps ?? [], add);

  if (guardrail === 'action_loop_limit') add('action_loop_limit');
  if (guardrail === 'model_error' || loop === 'error') add('model_error');
  if (guardrail === 'output_truncated') add('output_truncated');
  if (guardrail === 'budget' || loop === 'budget') add('budget');
  if (guardrail === 'tool_loop_limit' || loop === 'limit') add('tool_loop_limit');
  if (guardrail === 'invalid_tools' || loop === 'invalid_tools') add('invalid_tools');
  if (trace?.historySummarized) add('history_summarized');
  if (run.tier === 'basic' || (!trace && ctx.botTier === 'basic')) add('basic_tier');

  if ((trace?.messagesUndelivered ?? 0) > 0) add('not_delivered');
  if (guardrail === 'interrupted' || loop === 'interrupted') add('interrupted');
  if (trace?.commentReply) add('comment_reply');

  if (guardrail === 'provider_refusal') add('provider_refusal');
  const fallbackLine =
    (run.outcome === 'fallback' && guardrail !== 'interrupted') ||
    (run.outcome === 'answered' && guardrail !== null);
  if (fallbackLine) add('fallback_sent', guardrail ?? undefined);

  if (!trace) add('no_trace');

  const categoryRank = (c: Category) => TurnSignalCategory.options.indexOf(c);
  const codeRank = (c: Code) => TurnSignalCode.options.indexOf(c);
  return [...out.values()]
    .sort(
      (a, b) =>
        categoryRank(a.category) - categoryRank(b.category) ||
        codeRank(a.code) - codeRank(b.code) ||
        (a.detail ?? '').localeCompare(b.detail ?? ''),
    )
    .slice(0, MAX_SIGNALS);
}

/** True for a turn `problemsOnly` keeps: not answered, a guardrail, or a non-info signal. */
export function isProblemTurn(row: TurnRow, signals: readonly TurnSignal[]): boolean {
  return (
    row.run.outcome !== 'answered' ||
    row.run.guardrail !== null ||
    signals.some((s) => s.category !== 'info')
  );
}
