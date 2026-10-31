import type { WorkspaceId } from '@agent-sales/shared';

export interface ConversationSummaryValue {
  /** Timestamp of the last message the summary covers. */
  coveredUntil: Date;
  summary: string;
}

export interface ConversationSummaryRepository {
  get(ws: WorkspaceId, conversationId: string): Promise<ConversationSummaryValue | null>;
  put(ws: WorkspaceId, conversationId: string, value: ConversationSummaryValue): Promise<void>;
}

export const CONVERSATION_SUMMARY_REPOSITORY = Symbol('CONVERSATION_SUMMARY_REPOSITORY');
