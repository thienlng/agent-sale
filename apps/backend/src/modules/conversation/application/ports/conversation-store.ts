import type { ConversationDto, InboxMessageDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
export interface ConversationTx {
  lockPeer(channelId: string, customerId: string): Promise<void>;
  find(id: string): Promise<ConversationDto | null>;
  findPeer(channelId: string, customerId: string): Promise<ConversationDto | null>;
  list(): Promise<ConversationDto[]>;
  save(conversation: ConversationDto): Promise<void>;
  messages(id: string): Promise<InboxMessageDto[]>;
  findMessage(conversationId: string, key: string): Promise<InboxMessageDto | null>;
  saveMessage(message: InboxMessageDto, key: string): Promise<void>;
  /** Replaces the stored body of an existing message, keeping its idempotency key. */
  updateMessage(message: InboxMessageDto): Promise<void>;
  audit(id: string, type: string, payload: Record<string, unknown>): Promise<void>;
}
export interface ConversationStore {
  run<T>(ws: WorkspaceId, fn: (tx: ConversationTx) => Promise<T>): Promise<T>;
}
export const CONVERSATION_STORE = Symbol('CONVERSATION_STORE');
