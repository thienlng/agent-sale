import type { FanpageSettings, FanpageComment } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
/** Keyset position: activity time (UTC, microseconds) then comment id, both descending. */
export interface CommentPosition {
  activityAt: string;
  commentId: string;
}
export interface StoredCommentPost {
  postId: string;
  comments: number;
  lastActivityAt: string;
  context: FanpageComment['context'];
}
export interface FanpageStore {
  privateComments(
    ws: WorkspaceId,
    connectionId: string,
    recipientId: string,
  ): Promise<FanpageComment[]>;
  interrupted(ws: WorkspaceId, connectionId: string, comment: FanpageComment): Promise<boolean>;
  settings(ws: WorkspaceId, connectionId: string): Promise<FanpageSettings>;
  saveSettings(ws: WorkspaceId, connectionId: string, settings: FanpageSettings): Promise<void>;
  list(ws: WorkspaceId, connectionId: string): Promise<FanpageComment[]>;
  /** Newest activity first; `limit + 1` rows tell the caller whether another page exists. */
  page(
    ws: WorkspaceId,
    connectionId: string,
    input: { limit: number; after: CommentPosition | null; postId?: string; q?: string },
  ): Promise<{ comment: FanpageComment; position: CommentPosition }[]>;
  /** A plain read: no lock, no write, no activity bump. */
  get(ws: WorkspaceId, connectionId: string, commentId: string): Promise<FanpageComment | null>;
  /** Distinct posts of stored comments, newest activity first. */
  posts(ws: WorkspaceId, connectionId: string, limit: number): Promise<StoredCommentPost[]>;
  /** Serializes decisions and action reservations on one comment; no network work in this callback. */
  change<T>(
    ws: WorkspaceId,
    connectionId: string,
    commentId: string,
    fn: (current: FanpageComment | null) => { comment: FanpageComment | null; result: T },
  ): Promise<T>;
}
export const FANPAGE_STORE = Symbol('FANPAGE_STORE');
