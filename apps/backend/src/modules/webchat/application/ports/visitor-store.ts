import type { WorkspaceId } from '@agent-sales/shared';

export interface VisitorRecord {
  id: string;
  workspaceId: WorkspaceId;
  connectionId: string;
  conversationId: string | null;
  firstUrl: string | null;
  referrer: string | null;
  lastUrl: string | null;
  lastTitle: string | null;
  phoneE164: string | null;
  contactId: string | null;
  /** Messages the visitor has sent (retries of the same message count once). */
  messageCount: number;
  createdAt: string;
  lastSeenAt: string;
}

export interface VisitorMessageContext {
  firstUrl: string | null;
  referrer: string | null;
  lastUrl: string;
  lastTitle: string;
}

export interface VisitorStore {
  /** Creates the visitor on its first message, otherwise refreshes the page it is on and `last_seen_at`. */
  recordMessage(
    ws: WorkspaceId,
    connectionId: string,
    visitorId: string,
    context: VisitorMessageContext,
  ): Promise<void>;
  find(ws: WorkspaceId, connectionId: string, visitorId: string): Promise<VisitorRecord | null>;
  /** One more message sent by the visitor. */
  countMessage(ws: WorkspaceId, connectionId: string, visitorId: string): Promise<void>;
  /** Stores the captured phone and its customer; a later number replaces the earlier one. */
  recordPhone(
    ws: WorkspaceId,
    connectionId: string,
    visitorId: string,
    phoneE164: string,
    contactId: string,
  ): Promise<void>;
  /** Fills `conversation_id` once it is known (never overwrites). */
  linkConversation(
    ws: WorkspaceId,
    connectionId: string,
    visitorId: string,
    conversationId: string,
  ): Promise<void>;
}
export const VISITOR_STORE = Symbol('VISITOR_STORE');
