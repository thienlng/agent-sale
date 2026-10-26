import type { ChannelConnectionDto } from '@agent-sales/contracts';
import type { NormalizedEvent } from '@agent-sales/channels';
import type { WorkspaceId } from '@agent-sales/shared';
export interface PendingMetaEvent {
  claimToken: string;
  id: string;
  workspaceId: WorkspaceId;
  connectionId: string;
  event: NormalizedEvent;
  /** 1-based claim count; the store stops claiming after MAX_EVENT_ATTEMPTS. */
  attempt: number;
}
export const MAX_EVENT_ATTEMPTS = 3;
type OutboundAttachment = { type: 'image' | 'video' | 'audio' | 'file'; url: string };
/** Either text or attachments (one, or several delivered as one album), as Meta accepts per message. */
export interface OutboundInboxMessage {
  text: string;
  attachments?: readonly OutboundAttachment[] | undefined;
}
/** What Meta knows about a customer; either part can be missing. */
export interface CustomerProfile {
  name: string | null;
  avatarUrl: string | null;
}
export interface ChannelFacade {
  getConnection(ws: WorkspaceId, id: string): Promise<ChannelConnectionDto>;
  deliver(
    ws: WorkspaceId,
    id: string,
    recipient: string,
    message: OutboundInboxMessage,
    key: string,
  ): Promise<{
    externalId: string | null;
    status: 'sent' | 'failed' | 'unknown';
    failureCode: string | null;
  }>;
  /** Best-effort "seen" / "typing…" bubble for the customer; never throws. */
  presence(
    ws: WorkspaceId,
    id: string,
    recipient: string,
    action: 'mark_seen' | 'typing_on',
  ): Promise<void>;
  /**
   * Best-effort name and picture of a customer of this page (Messenger PSID or Instagram-scoped
   * id), read with the page token. Resolves `null` on any failure; the token never leaves the module.
   */
  fetchCustomerProfile(
    ws: WorkspaceId,
    channelId: string,
    customerExternalId: string,
  ): Promise<CustomerProfile | null>;
  claimEvents(limit: number): Promise<PendingMetaEvent[]>;
  renewEvent(id: string, claimToken: string): Promise<boolean>;
  completeEvent(id: string, claimToken: string): Promise<void>;
  /** Terminal failure: keeps the payload for replay and stops further claims. */
  deadLetterEvent(id: string, claimToken: string): Promise<void>;
  /** Dead-letters events whose last attempt ended without completion (e.g. a crashed worker). */
  deadLetterExhaustedEvents(): Promise<string[]>;
  /** Ends a failed attempt early so the next claim can retry after `retryInMs` instead of the full lease. */
  releaseEvent(id: string, claimToken: string, retryInMs: number): Promise<void>;
  /** Hands the event back without spending an attempt, to be answered together with newer messages. */
  requeueEvent(id: string, claimToken: string): Promise<void>;
  /** Whether the same customer wrote again after this event (its answer would already be stale). */
  hasNewerCustomerEvent(
    connectionId: string,
    senderExternalId: string,
    afterEventId: string,
  ): Promise<boolean>;
}
export const CHANNEL_FACADE = Symbol('CHANNEL_FACADE');
