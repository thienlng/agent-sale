import type {
  ConversationCounts,
  ConversationDetailDto,
  ConversationTagAssignmentDto,
  ConversationView,
  ConversationListQuery,
  InboxMessageDto,
  SendInboxMessageRequest,
  UpdateConversationRequest,
} from '@agent-sales/contracts';
import type { NormalizedEvent } from '@agent-sales/channels';
import type { WorkspaceId } from '@agent-sales/shared';
export interface ConversationFacade {
  list(
    ws: WorkspaceId,
    query: ConversationListQuery,
    viewerId?: string,
  ): Promise<{ data: ConversationView[]; counts: ConversationCounts }>;
  get(ws: WorkspaceId, id: string): Promise<ConversationDetailDto>;
  send(
    ws: WorkspaceId,
    id: string,
    input: SendInboxMessageRequest,
    actorId: string,
  ): Promise<InboxMessageDto>;
  update(
    ws: WorkspaceId,
    id: string,
    input: UpdateConversationRequest,
    actorId: string,
  ): Promise<ConversationView>;
  /** Active tags of a conversation (the tag library belongs to crm). */
  listTags(ws: WorkspaceId, id: string): Promise<ConversationTagAssignmentDto[]>;
  addTag(
    ws: WorkspaceId,
    id: string,
    input: unknown,
    actorId: string,
  ): Promise<{ created: boolean; assignment: ConversationTagAssignmentDto }>;
  markRead(ws: WorkspaceId, id: string, actorId: string): Promise<ConversationView>;
  markUnread(ws: WorkspaceId, id: string): Promise<ConversationView>;
  addNote(ws: WorkspaceId, id: string, text: string, actorId: string): Promise<ConversationView>;
  /**
   * Best-effort name and avatar lookup after a customer message; at most one Meta call per
   * conversation per day. Never throws.
   */
  refreshCustomerProfile(ws: WorkspaceId, id: string): Promise<void>;
  receive(ws: WorkspaceId, channelId: string, event: NormalizedEvent): Promise<ConversationView>;
  getReplyContext(
    ws: WorkspaceId,
    id: string,
  ): Promise<ConversationDetailDto & { revision: number }>;
  commitBotReply(
    ws: WorkspaceId,
    id: string,
    input: { revision: number; text: string; idempotencyKey: string },
  ): Promise<InboxMessageDto | null>;
}
export const CONVERSATION_FACADE = Symbol('CONVERSATION_FACADE');
/** Agent entry capability; never started by the HTTP process. */
export interface ConversationRunner {
  tick(): Promise<void>;
}
export const CONVERSATION_RUNNER = Symbol('CONVERSATION_RUNNER');
