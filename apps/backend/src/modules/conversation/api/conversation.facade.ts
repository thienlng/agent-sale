import type {
  ConversationDetailDto,
  ConversationDto,
  ConversationListQuery,
  InboxMessageDto,
  SendInboxMessageRequest,
  UpdateConversationRequest,
} from '@agent-sales/contracts';
import type { NormalizedEvent } from '@agent-sales/channels';
import type { WorkspaceId } from '@agent-sales/shared';
export interface ConversationFacade {
  list(ws: WorkspaceId, query: ConversationListQuery): Promise<{ data: ConversationDto[] }>;
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
  ): Promise<ConversationDto>;
  receive(ws: WorkspaceId, channelId: string, event: NormalizedEvent): Promise<ConversationDto>;
  getReplyContext(
    ws: WorkspaceId,
    id: string,
  ): Promise<ConversationDetailDto & { revision: number }>;
  commitBotReply(
    ws: WorkspaceId,
    id: string,
    input: { revision: number; text: string; idempotencyKey: string },
  ): Promise<InboxMessageDto | null>;
  /**
   * One picture after a committed bot reply (attachment `image`, https URL). Same delivery path,
   * idempotency and 24-hour window as the text; null when a human took over meanwhile. A failed
   * send is stored as a failed outbound message and returned, never thrown.
   */
  commitBotImage(
    ws: WorkspaceId,
    id: string,
    input: { url: string; idempotencyKey: string },
  ): Promise<InboxMessageDto | null>;
}
export const CONVERSATION_FACADE = Symbol('CONVERSATION_FACADE');
/** Agent entry capability; never started by the HTTP process. */
export interface ConversationRunner {
  tick(): Promise<void>;
}
export const CONVERSATION_RUNNER = Symbol('CONVERSATION_RUNNER');
