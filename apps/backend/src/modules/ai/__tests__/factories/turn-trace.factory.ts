import { newId } from '@agent-sales/shared';

import type { AiRunRecord } from '../../domain/ports/ai-run.repository.js';
import type { TurnTraceRecord } from '../../domain/ports/turn-trace.repository.js';

/** An `ai_runs` record with test defaults. */
export function runRecord(over: Partial<AiRunRecord> = {}): AiRunRecord {
  return {
    id: newId(),
    botId: newId(),
    conversationId: null,
    tier: 'smart',
    provider: 'fake',
    model: 'fake-1',
    promptVersion: 'v1',
    inputTokens: 10,
    outputTokens: 5,
    cachedTokens: 0,
    latencyMs: 2_000,
    retrieved: [],
    outcome: 'answered',
    guardrail: null,
    isTest: false,
    productIds: [],
    createdAt: new Date(),
    ...over,
  };
}

/** A trace for `run` with test defaults. */
export function traceRecord(
  run: AiRunRecord,
  over: Partial<TurnTraceRecord> = {},
): TurnTraceRecord {
  return {
    runId: run.id,
    botId: run.botId,
    conversationId: run.conversationId,
    startedAt: new Date(run.createdAt.getTime() - run.latencyMs),
    channel: 'messenger',
    commentReply: false,
    historyTurns: 2,
    historySummarized: false,
    customerImages: 0,
    queryExcerpt: null,
    replyExcerpt: null,
    scenarioIds: [],
    focusProductIds: [],
    actionIds: [],
    pendingAction: false,
    offeredTools: ['send_message'],
    systemPromptSha: 'a'.repeat(64),
    situationsSha: 'b'.repeat(64),
    modelCalls: 1,
    loopOutcome: 'done',
    messagesSent: 1,
    messagesUndelivered: 0,
    ...over,
  };
}
