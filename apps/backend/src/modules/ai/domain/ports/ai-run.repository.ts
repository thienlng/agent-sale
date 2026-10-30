import type { WorkspaceId } from '@agent-sales/shared';

/** One LLM turn, written for metering and for "which sources did the bot use". */
export interface AiRunRecord {
  id: string;
  botId: string;
  conversationId: string | null;
  tier: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  latencyMs: number;
  retrieved: Array<{ faqId: string; score: number; used: boolean }>;
  outcome: 'answered' | 'fallback' | 'handoff';
  guardrail: string | null;
  isTest: boolean;
  /** Ids of the products the model saw in this turn (focus-products memory). */
  productIds: string[];
  createdAt: Date;
}

export interface AiRunRepository {
  record(workspaceId: WorkspaceId, run: AiRunRecord): Promise<void>;
  /** Product ids of the most recent runs of a conversation, newest first, de-duplicated, max `limit`. */
  recentProductIds(
    workspaceId: WorkspaceId,
    conversationId: string,
    opts: { runs: number; limit: number; since?: Date },
  ): Promise<string[]>;
}

export const AI_RUN_REPOSITORY = Symbol('AI_RUN_REPOSITORY');
