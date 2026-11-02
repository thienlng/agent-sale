import { z } from 'zod';

import { AiOutcome } from './ai.schema.js';

/**
 * Shop-bot turn traces (T-174): the read side of `ai_run_traces` / `ai_run_steps` for the owner
 * assistant's bot doctor. Spec `2026-11-02-owner-assistant-doctor-design` §5.
 */

/** Query-string booleans arrive as text. */
const queryBool = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean().optional(),
);

/** The doctor's diagnosis classes, in display order. */
export const TurnSignalCategory = z.enum([
  'missing_knowledge',
  'instructions',
  'product_data',
  'tool_failure',
  'model_limit',
  'channel',
  'guardrail',
  'info',
]);
export type TurnSignalCategory = z.infer<typeof TurnSignalCategory>;

export const TurnSignalCode = z.enum([
  'no_faq_hits',
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
export type TurnSignalCode = z.infer<typeof TurnSignalCode>;

/** A deterministic hint of what went wrong in a turn: evidence, not the verdict. */
export const TurnSignal = z.object({
  code: TurnSignalCode,
  category: TurnSignalCategory,
  detail: z.string().max(200).optional(),
});
export type TurnSignal = z.infer<typeof TurnSignal>;

export const BotTurnListQuery = z.object({
  conversationId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  /** A moment (e.g. a bot message's time): the turns whose window contains it, nearest first. */
  around: z.iso.datetime({ offset: true }).optional(),
  /** Accent-insensitive substring of the customer or reply excerpt. */
  q: z.string().trim().min(1).max(100).optional(),
  problemsOnly: queryBool,
  includeTests: queryBool,
  limit: z.coerce.number().int().min(1).max(20).default(10),
  cursor: z.string().max(200).optional(),
});
export type BotTurnListQuery = z.infer<typeof BotTurnListQuery>;

export const BotTurnSummary = z.object({
  runId: z.uuid(),
  conversationId: z.uuid().nullable(),
  isTest: z.boolean(),
  startedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  outcome: AiOutcome,
  guardrail: z.string().nullable(),
  tier: z.string(),
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  latencyMs: z.number().int(),
  queryExcerpt: z.string().nullable(),
  replyExcerpt: z.string().nullable(),
  hasTrace: z.boolean(),
  signals: z.array(TurnSignal),
});
export type BotTurnSummary = z.infer<typeof BotTurnSummary>;

export const BotTurnList = z.object({
  items: z.array(BotTurnSummary),
  nextCursor: z.string().nullable(),
});
export type BotTurnList = z.infer<typeof BotTurnList>;

export const BotTurnStep = z.object({
  idx: z.number().int(),
  kind: z.string(),
  toolName: z.string().nullable(),
  ok: z.boolean().nullable(),
  errorCode: z.string().nullable(),
  ms: z.number().int().nullable(),
  detail: z.record(z.string(), z.unknown()).nullable(),
});
export type BotTurnStep = z.infer<typeof BotTurnStep>;

export const BotTurnDetail = BotTurnSummary.extend({
  inputTokens: z.number().int(),
  cachedTokens: z.number().int(),
  outputTokens: z.number().int(),
  channel: z.string().nullable(),
  commentReply: z.boolean().nullable(),
  historyTurns: z.number().int().nullable(),
  historySummarized: z.boolean().nullable(),
  customerImages: z.number().int().nullable(),
  /** FAQ hits of the turn with today's question text (`exists: false` when deleted since). */
  faqHits: z.array(
    z.object({
      faqId: z.uuid(),
      question: z.string().max(300).nullable(),
      score: z.number(),
      used: z.boolean(),
      exists: z.boolean(),
    }),
  ),
  /** Scenarios rendered into the turn, with today's title. */
  scenarios: z.array(
    z.object({ id: z.uuid(), title: z.string().max(200).nullable(), exists: z.boolean() }),
  ),
  offeredTools: z.array(z.string()),
  actionIds: z.array(z.uuid()),
  focusProductIds: z.array(z.uuid()),
  pendingAction: z.boolean().nullable(),
  modelCalls: z.number().int().nullable(),
  loopOutcome: z.string().nullable(),
  /** Today's rendered system prompt differs from the turn's (null without a trace). */
  instructionsChangedSince: z.boolean().nullable(),
  /** Today's `<shop_situations>` differ from the turn's (null without a trace). */
  trainingChangedSince: z.boolean().nullable(),
  steps: z.array(BotTurnStep),
});
export type BotTurnDetail = z.infer<typeof BotTurnDetail>;
