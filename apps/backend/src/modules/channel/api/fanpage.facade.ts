import type {
  FanpageSettings,
  FanpageComment,
  FanpagePost,
  FanpageContext,
  FanpageActionKind,
  FanpageAction,
} from '@agent-sales/contracts';
import type { NormalizedEvent } from '@agent-sales/channels';
import type { WorkspaceId } from '@agent-sales/shared';
export interface FanpageFacade {
  pageReply(ws: WorkspaceId, connectionId: string, event: NormalizedEvent): Promise<void>;
  privateContext(
    ws: WorkspaceId,
    connectionId: string,
    recipientId: string,
  ): Promise<{
    status: 'none' | 'ready' | 'unavailable' | 'ambiguous';
    context: FanpageContext | null;
  }>;
  settings(ws: WorkspaceId, connectionId: string): Promise<FanpageSettings>;
  saveSettings(
    ws: WorkspaceId,
    connectionId: string,
    settings: FanpageSettings,
  ): Promise<FanpageSettings>;
  posts(ws: WorkspaceId, connectionId: string): Promise<FanpagePost[]>;
  comments(ws: WorkspaceId, connectionId: string): Promise<FanpageComment[]>;
  receive(ws: WorkspaceId, connectionId: string, event: NormalizedEvent): Promise<FanpageComment>;
  context(
    ws: WorkspaceId,
    connectionId: string,
    commentId: string,
    version: string,
  ): Promise<FanpageContext | null>;
  review(ws: WorkspaceId, connectionId: string, commentId: string, version: string): Promise<void>;
  act(
    ws: WorkspaceId,
    connectionId: string,
    commentId: string,
    input: {
      kind: FanpageActionKind;
      text: string;
      reason: string;
      key: string;
      version?: string;
      automatic: boolean;
      actorId?: string;
      expectedBotId?: string;
    },
  ): Promise<FanpageAction | null>;
}
export const FANPAGE_FACADE = Symbol('FANPAGE_FACADE');
