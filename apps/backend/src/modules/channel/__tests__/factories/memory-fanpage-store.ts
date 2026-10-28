import { FanpageSettings, type FanpageComment } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import type {
  CommentPosition,
  FanpageStore,
  PostPosition,
  StoredCommentPost,
} from '../../application/ports/fanpage-store.js';
export class MemoryFanpageStore implements FanpageStore {
  async privateComments(ws: WorkspaceId, id: string, recipientId: string) {
    return (await this.list(ws, id)).filter((c) =>
      c.actions.some(
        (a) => a.kind === 'private_reply' && a.status === 'sent' && a.recipientId === recipientId,
      ),
    );
  }
  blocked = false;
  async interrupted() {
    return this.blocked;
  }
  readonly records = new Map<string, FanpageComment>();
  /** Activity time per record, like `updated_at`; tests may set equal values to force ties. */
  readonly activity = new Map<string, string>();
  readonly preferences = new Map<string, FanpageSettings>();
  async settings(ws: WorkspaceId, id: string) {
    return structuredClone(this.preferences.get(`${ws}/${id}`) ?? FanpageSettings.parse({}));
  }
  async saveSettings(ws: WorkspaceId, id: string, input: FanpageSettings) {
    this.preferences.set(`${ws}/${id}`, structuredClone(input));
  }
  async list(ws: WorkspaceId, id: string) {
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(`${ws}/${id}/`))
      .map(([, c]) => structuredClone(c));
  }
  async change<T>(
    ws: WorkspaceId,
    id: string,
    commentId: string,
    fn: (current: FanpageComment | null) => { comment: FanpageComment | null; result: T },
  ): Promise<T> {
    const key = `${ws}/${id}/${commentId}`,
      old = this.records.get(key),
      { comment, result } = fn(old ? structuredClone(old) : null);
    if (comment) {
      this.records.set(key, structuredClone(comment));
      this.activity.set(key, new Date().toISOString());
    }
    return result;
  }
  private rows(ws: WorkspaceId, id: string) {
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(`${ws}/${id}/`))
      .map(([key, comment]) => ({
        comment: structuredClone(comment),
        position: { activityAt: this.activity.get(key) ?? '', commentId: comment.commentId },
      }))
      .sort((a, b) => compare(b.position, a.position));
  }
  async page(
    ws: WorkspaceId,
    id: string,
    input: { limit: number; after: CommentPosition | null; postId?: string; q?: string },
  ) {
    const q = input.q?.toLowerCase();
    return this.rows(ws, id)
      .filter(
        ({ comment, position }) =>
          (!input.postId || comment.postId === input.postId) &&
          (!q || comment.text.toLowerCase().includes(q) || comment.authorId === input.q) &&
          (!input.after || compare(position, input.after) < 0),
      )
      .slice(0, input.limit);
  }
  async get(ws: WorkspaceId, id: string, commentId: string) {
    const found = this.records.get(`${ws}/${id}/${commentId}`);
    return found ? structuredClone(found) : null;
  }
  async posts(ws: WorkspaceId, id: string, input: { limit: number; after: PostPosition | null }) {
    const posts = new Map<string, StoredCommentPost>();
    for (const { comment, position } of this.rows(ws, id)) {
      const known = posts.get(comment.postId);
      if (known) {
        known.comments += 1;
        known.context ??= comment.context;
      } else
        posts.set(comment.postId, {
          postId: comment.postId,
          comments: 1,
          lastActivityAt: position.activityAt,
          context: comment.context,
        });
    }
    const key = (p: StoredCommentPost) => ({ activityAt: p.lastActivityAt, commentId: p.postId });
    const after = input.after && {
      activityAt: input.after.activityAt,
      commentId: input.after.postId,
    };
    return [...posts.values()]
      .sort((a, b) => compare(key(b), key(a)))
      .filter((p) => !after || compare(key(p), after) < 0)
      .slice(0, input.limit);
  }
}

function compare(a: CommentPosition, b: CommentPosition): number {
  return a.activityAt === b.activityAt
    ? a.commentId.localeCompare(b.commentId)
    : a.activityAt.localeCompare(b.activityAt);
}
