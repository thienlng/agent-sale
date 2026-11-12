import { newId } from '@agent-sales/shared';

import type { ConversationLlmBudget, OwnerLlmBudget } from '../../../common/limits/llm-budget.js';
import type { BotView } from '../../bot/api/index.js';
import type { BotCommitQuota } from './commit-quota.js';
import type { ReplyResult } from '../api/reply-options.js';
import { defaultHandoffMessage } from '../domain/default-messages.js';

/** The model budgets the reply service enforces (security audit 2026-11-12 #15). */
export interface AiSpendLimits {
  /** Shop-bot calls and tokens per conversation and hour. */
  conversation?: ConversationLlmBudget;
  /** Playground per-user rate and the account's daily tokens. */
  owner?: OwnerLlmBudget;
  /** Orders and holds the bot commits per customer and day (audit #18). */
  commits?: BotCommitQuota;
}

export const AI_SPEND_LIMITS = Symbol('AI_SPEND_LIMITS');

/**
 * The turn a conversation over its hourly model budget gets: no model call, the bot's hand-over
 * message and outcome `handoff`, so the caller hands the conversation to staff.
 */
export function budgetHandoff(bot: BotView): ReplyResult {
  const text = bot.handoffMessage.trim() || defaultHandoffMessage(bot);
  return {
    runId: newId(),
    reply: text,
    outcome: 'handoff',
    guardrail: 'conversation_budget',
    sources: [],
    images: [],
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
    provider: '',
    model: '',
    latencyMs: 0,
    messages: [],
    steps: [],
  };
}
