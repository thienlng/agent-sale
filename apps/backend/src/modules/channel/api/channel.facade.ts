import type { ChannelConnectionDto } from '@agent-sales/contracts';
import type { NormalizedEvent } from '@agent-sales/channels';
import type { WorkspaceId } from '@agent-sales/shared';
export interface PendingMetaEvent {
  claimToken: string;
  id: string;
  workspaceId: WorkspaceId;
  connectionId: string;
  event: NormalizedEvent;
}
export interface ChannelFacade {
  getConnection(ws: WorkspaceId, id: string): Promise<ChannelConnectionDto>;
  deliver(
    ws: WorkspaceId,
    id: string,
    recipient: string,
    text: string,
    key: string,
  ): Promise<{
    externalId: string | null;
    status: 'sent' | 'failed' | 'unknown';
    failureCode: string | null;
  }>;
  claimEvents(limit: number): Promise<PendingMetaEvent[]>;
  renewEvent(id: string, claimToken: string): Promise<boolean>;
  completeEvent(id: string, claimToken?: string): Promise<void>;
}
export const CHANNEL_FACADE = Symbol('CHANNEL_FACADE');
