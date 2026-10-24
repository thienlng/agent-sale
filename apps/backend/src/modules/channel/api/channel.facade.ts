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
/** Either text or a single attachment, mirroring what Meta accepts per message. */
export interface OutboundInboxMessage {
  text: string;
  attachment?: { type: 'image' | 'video' | 'audio' | 'file'; url: string } | undefined;
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
  claimEvents(limit: number): Promise<PendingMetaEvent[]>;
  renewEvent(id: string, claimToken: string): Promise<boolean>;
  completeEvent(id: string, claimToken?: string): Promise<void>;
  /** Ends a failed attempt early so the next claim can retry after `retryInMs` instead of the full lease. */
  releaseEvent(id: string, claimToken: string, retryInMs: number): Promise<void>;
}
export const CHANNEL_FACADE = Symbol('CHANNEL_FACADE');
