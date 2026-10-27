import { MetaRequestError, type FacebookPostsAdapter } from '@agent-sales/channels';
import type { FanpageCommentListQuery, FanpageCommentSource } from '@agent-sales/contracts';
import { exposesContactDetails, type WorkspaceId } from '@agent-sales/shared';
import { z } from 'zod';
import type { FanpageFacade } from '../api/fanpage.facade.js';
import { ChannelError } from '../domain/channel.errors.js';
import type { ChannelStore } from './ports/channel-store.js';
import type { CommentPosition, FanpageStore } from './ports/fanpage-store.js';
const Cursor = z.object({
  v: z.literal(1),
  c: z.string(),
  p: z.string().nullable(),
  q: z.string().nullable(),
  a: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3,6}Z$/),
  i: z.string().max(200),
});
type Cursor = z.infer<typeof Cursor>;
const encodeCursor = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');
function decodeCursor(raw: string): Cursor {
  try {
    return Cursor.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
  } catch {
    throw new ChannelError('VALIDATION_FAILED', 'Invalid cursor');
  }
}
/** Graph lookup failures, as a reason staff can act on. */
function unavailableReason(
  error: MetaRequestError,
): Extract<FanpageCommentSource, { status: 'unavailable' }>['reason'] {
  if (error.code === 'auth_expired') return 'reconnect';
  if (error.code === 'permission_denied') return 'permission';
  if (error.uncertain) return 'provider';
  return error.code === 'provider_rejected' ? 'missing' : 'mismatch';
}
interface Access {
  connection(ws: WorkspaceId, id: string): Promise<unknown>;
  asset(ws: WorkspaceId, id: string): Promise<{ externalId: string; token: string }>;
  adapter(): FacebookPostsAdapter;
  review(ws: WorkspaceId, id: string, commentId: string, version: string): Promise<void>;
}
/** The Inbox comment workspace: side-effect-free reads and the pre-action source check. */
export class FanpageCommentInbox {
  constructor(
    private readonly channels: ChannelStore,
    private readonly store: FanpageStore,
    private readonly access: Access,
  ) {}
  async comments(ws: WorkspaceId, id: string, query: FanpageCommentListQuery = {}) {
    await this.access.connection(ws, id);
    const paged = Object.values(query).some((v) => v !== undefined),
      limit = paged ? (query.limit ?? 30) : 100,
      postId = query.postId ?? null,
      q = query.q ?? null;
    let after: CommentPosition | null = null;
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      // A cursor only continues the exact list it came from; it never selects another Page's rows.
      if (cursor.c !== id || cursor.p !== postId || cursor.q !== q)
        throw new ChannelError('VALIDATION_FAILED', 'Cursor does not match this list');
      after = { activityAt: cursor.a, commentId: cursor.i };
    }
    const rows = await this.store.page(ws, id, {
      limit: limit + 1,
      after,
      ...(postId ? { postId } : {}),
      ...(q ? { q } : {}),
    });
    const last = rows.length > limit ? rows[limit - 1] : undefined;
    return {
      data: rows.slice(0, limit).map((r) => r.comment),
      nextCursor: last
        ? encodeCursor({
            v: 1,
            c: id,
            p: postId,
            q,
            a: last.position.activityAt,
            i: last.position.commentId,
          })
        : null,
    };
  }
  async comment(ws: WorkspaceId, id: string, commentId: string) {
    await this.access.connection(ws, id);
    const data = await this.store.get(ws, id, commentId);
    if (!data) throw new ChannelError('NOT_FOUND', 'Comment not found');
    const parent = data.parentId ? await this.store.get(ws, id, data.parentId) : null;
    return {
      data,
      parent: parent
        ? {
            commentId: parent.commentId,
            authorId: parent.authorId,
            text: parent.text,
            deleted: parent.deleted,
          }
        : null,
    };
  }
  async source(ws: WorkspaceId, id: string, commentId: string): Promise<FanpageCommentSource> {
    await this.access.connection(ws, id);
    const current = await this.store.get(ws, id, commentId);
    if (!current) throw new ChannelError('NOT_FOUND', 'Comment not found');
    let asset: { externalId: string; token: string };
    try {
      asset = await this.access.asset(ws, id);
    } catch (error) {
      if (error instanceof ChannelError && error.code === 'UNAVAILABLE')
        return { status: 'unavailable', reason: 'reconnect' };
      throw error;
    }
    try {
      const thread = await this.access.adapter().thread(asset, current.postId, commentId);
      return {
        status: 'fresh',
        post: thread.post,
        parentText: thread.parentText,
        commentText: thread.text,
        matchesStored: thread.text === current.text && thread.authorId === current.authorId,
      };
    } catch (error) {
      if (!(error instanceof MetaRequestError)) throw error;
      if (error.code === 'auth_expired')
        await this.channels.update(ws, id, { status: 'reauth_required' });
      return { status: 'unavailable', reason: unavailableReason(error) };
    }
  }
  async commentPosts(ws: WorkspaceId, id: string) {
    await this.access.connection(ws, id);
    return (await this.store.posts(ws, id, 200)).map((p) => ({
      postId: p.postId,
      comments: p.comments,
      lastActivityAt: p.lastActivityAt,
      text: p.context?.text ?? null,
      permalink: p.context?.permalink || null,
    }));
  }
  /**
   * Staff actions check Facebook's current comment before anything is reserved, even with a
   * stored snapshot: a deleted, edited or unreadable source is refused instead of answered.
   */
  async verifyManual(
    ws: WorkspaceId,
    id: string,
    commentId: string,
    input: Parameters<FanpageFacade['act']>[3],
  ): Promise<string> {
    const current = await this.store.get(ws, id, commentId);
    if (!current) throw new ChannelError('NOT_FOUND', 'Comment not found');
    if (current.deleted) throw new ChannelError('CONFLICT', 'The comment was deleted on Facebook');
    if (input.version && input.version !== current.version)
      throw new ChannelError('CONFLICT', 'The comment changed; review the latest version');
    if (
      input.kind === 'public_reply' &&
      !input.confirmPublicContact &&
      exposesContactDetails(input.text)
    )
      throw new ChannelError(
        'VALIDATION_FAILED',
        'A public reply contains a phone number or email; confirm it or reply privately',
      );
    const asset = await this.access.asset(ws, id);
    let thread;
    try {
      thread = await this.access.adapter().thread(asset, current.postId, commentId);
    } catch (error) {
      if (!(error instanceof MetaRequestError)) throw error;
      if (error.code === 'auth_expired') {
        await this.channels.update(ws, id, { status: 'reauth_required' });
        throw new ChannelError('UNAVAILABLE', 'Reconnect the page');
      }
      if (error.uncertain)
        throw new ChannelError('UNAVAILABLE', 'Facebook did not answer; try again shortly');
      throw new ChannelError(
        'CONFLICT',
        'The post or comment is no longer available on Facebook, or page access changed',
      );
    }
    if (thread.authorId === asset.externalId)
      throw new ChannelError('VALIDATION_FAILED', "This is the Page's own comment");
    if (thread.authorId !== current.authorId || thread.text !== current.text) {
      await this.access.review(ws, id, commentId, current.version);
      throw new ChannelError(
        'CONFLICT',
        'The comment changed on Facebook; wait for the update before acting',
      );
    }
    const context = {
      ...thread.post,
      pageId: asset.externalId,
      commentId,
      parentText: thread.parentText,
    };
    const verified = await this.store.change(ws, id, commentId, (c) =>
      c && c.version === current.version && !c.deleted
        ? {
            comment: { ...c, context, occurredAt: new Date(thread.createdAt).toISOString() },
            result: true,
          }
        : { comment: null, result: false },
    );
    if (!verified) throw new ChannelError('CONFLICT', 'The comment changed; review it again');
    return current.version;
  }
}
