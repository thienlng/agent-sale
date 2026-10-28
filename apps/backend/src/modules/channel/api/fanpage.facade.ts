import type {
  FanpageSettings,
  FanpageComment,
  FanpagePost,
  FanpageContext,
  FanpageActionKind,
  FanpageAction,
  FanpageCommentListQuery,
  FanpageCommentPage,
  FanpageCommentDetail,
  FanpageCommentSource,
  FanpageCommentPostPage,
  FanpageCommentPostsQuery,
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
  /** Stored received comments; no query keeps the original newest-100 answer. */
  comments(
    ws: WorkspaceId,
    connectionId: string,
    query?: FanpageCommentListQuery,
  ): Promise<FanpageCommentPage>;
  /** One stored comment, read without any side effect on automation or ordering. */
  comment(ws: WorkspaceId, connectionId: string, commentId: string): Promise<FanpageCommentDetail>;
  /** Fresh Facebook read of the comment's post/thread; stores nothing. */
  source(ws: WorkspaceId, connectionId: string, commentId: string): Promise<FanpageCommentSource>;
  /** Posts known from stored comments, newest activity first, by opaque cursor. */
  commentPosts(
    ws: WorkspaceId,
    connectionId: string,
    query?: FanpageCommentPostsQuery,
  ): Promise<FanpageCommentPostPage>;
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
      /** Manual public replies only: staff confirmed posting a phone number or email. */
      confirmPublicContact?: boolean;
    },
  ): Promise<FanpageAction | null>;
}
export const FANPAGE_FACADE = Symbol('FANPAGE_FACADE');
