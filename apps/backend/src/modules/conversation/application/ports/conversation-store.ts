import type { ConversationView, InboxMessageDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import type { ConversationFilter, ConversationPage } from '../../domain/conversation-filter.js';
export interface ConversationTx {
  lockPeer(channelId: string, customerId: string): Promise<void>;
  find(id: string): Promise<ConversationView | null>;
  /** Who holds the conversation, read without a row lock (polled while the agent works). */
  peekControl(id: string): Promise<Pick<ConversationView, 'mode' | 'status'> | null>;
  findPeer(channelId: string, customerId: string): Promise<ConversationView | null>;
  /** Filters, counts and sorts in the store (SQL), newest activity first by default. */
  query(filter: ConversationFilter): Promise<ConversationPage>;
  /** Writes the document and the derived index columns together. */
  save(conversation: ConversationView): Promise<void>;
  messages(id: string): Promise<InboxMessageDto[]>;
  /**
   * Read-only (no row lock) page of a peer's messages ordered by id ascending, strictly after the
   * cursor; `conversationId` is null when the peer has no conversation yet.
   */
  peerMessagesAfter(
    channelId: string,
    customerId: string,
    afterMessageId: string | null,
    limit: number,
  ): Promise<{ conversationId: string | null; messages: InboxMessageDto[] }>;
  findMessage(conversationId: string, key: string): Promise<InboxMessageDto | null>;
  saveMessage(message: InboxMessageDto, key: string): Promise<void>;
  /** Replaces the stored body of an existing message, keeping its idempotency key. */
  updateMessage(message: InboxMessageDto): Promise<void>;
  audit(id: string, type: string, payload: Record<string, unknown>): Promise<void>;
  /** Detaches every conversation from a deleted bot (soft deletes never fire the FK's SET NULL). */
  releaseBot(botId: string): Promise<void>;
  /**
   * Open conversations with `awaiting_since <= olderThan` (the waiting partial index): the count,
   * the oldest wait, the count per provider and up to `limit` ids, oldest first.
   */
  awaitingReply(q: { olderThan: Date; limit: number }): Promise<{
    count: number;
    oldestSince: string | null;
    byChannel: { channel: string; count: number }[];
    ids: string[];
  }>;
  /** See `ConversationFacade.todayCandidates`. */
  todayCandidates(q: {
    ids: readonly string[];
    awaitingBefore: Date;
    followUpBefore: Date;
    limit: number;
    visibleTo?: string | undefined;
    lastHumanFor?: readonly string[] | undefined;
  }): Promise<TodayCandidateRow[]>;
}
/** A Today candidate: the conversation and the time of its last delivered staff message. */
export interface TodayCandidateRow {
  conversation: ConversationView;
  lastHumanReplyAt: string | null;
}
export interface ConversationStore {
  run<T>(ws: WorkspaceId, fn: (tx: ConversationTx) => Promise<T>): Promise<T>;
}
export const CONVERSATION_STORE = Symbol('CONVERSATION_STORE');
