import type { NormalizedEvent } from '@agent-sales/channels';
import { interruptsComment } from '../../domain/comment-interruption.js';
import { sql, withTenant, type Database } from '@agent-sales/db';
import { FanpageSettings, FanpageComment } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import type {
  CommentPosition,
  FanpageStore,
  PostPosition,
  StoredCommentPost,
} from '../../application/ports/fanpage-store.js';
import { ChannelError } from '../../domain/channel.errors.js';
const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, '\\$&')}%`;
// Full microsecond precision, so a cursor taken from one row compares equal to that row again.
const activity = sql.raw(`to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
const postActivity = sql.raw(
  `to_char(max(updated_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
);
export class DrizzleFanpageStore implements FanpageStore {
  constructor(private readonly db: Database) {}
  privateComments(ws: WorkspaceId, connectionId: string, recipientId: string) {
    return withTenant(this.db, ws, async (tx) => {
      const match = JSON.stringify([{ kind: 'private_reply', status: 'sent', recipientId }]);
      const rows = await tx.execute<{ document: unknown }>(
        sql`select document from fanpage_comments where workspace_id=${ws} and connection_id=${connectionId} and document->'actions' @> ${match}::jsonb order by updated_at desc limit 101`,
      );
      return rows.map((row) => FanpageComment.parse(row.document));
    });
  }
  interrupted(ws: WorkspaceId, connectionId: string, comment: FanpageComment) {
    return withTenant(this.db, ws, async (tx) => {
      const rows = await tx.execute<{ payload: unknown }>(
        sql`select payload from channel_webhook_events where workspace_id=${ws} and connection_id=${connectionId} and payload->>'type'='comment' and ((processed_at is null and payload->'comment'->>'commentId'=${comment.commentId}) or (payload->'comment'->>'parentId'=${comment.commentId} and payload->>'senderExternalId'=${comment.postId.split('_')[0] ?? ''}))`,
      );
      return rows.some((row) =>
        interruptsComment(
          comment,
          row.payload as NormalizedEvent,
          comment.postId.split('_')[0] ?? '',
        ),
      );
    });
  }
  settings(ws: WorkspaceId, connectionId: string) {
    return withTenant(this.db, ws, async (tx) => {
      const rows = await tx.execute<{ settings: unknown }>(
        sql`select settings from fanpage_settings where workspace_id=${ws} and connection_id=${connectionId}`,
      );
      return FanpageSettings.parse(rows[0]?.settings ?? {});
    });
  }
  async saveSettings(ws: WorkspaceId, connectionId: string, settings: FanpageSettings) {
    await withTenant(this.db, ws, async (tx) => {
      await tx.execute(sql`insert into fanpage_settings(workspace_id,connection_id,settings) values (${ws},${connectionId},${JSON.stringify(settings)}::jsonb)
        on conflict(connection_id) do update set settings=excluded.settings where fanpage_settings.workspace_id=${ws}`);
    });
  }
  list(ws: WorkspaceId, connectionId: string) {
    return withTenant(this.db, ws, async (tx) => {
      const rows = await tx.execute<{ document: unknown }>(
        sql`select document from fanpage_comments where workspace_id=${ws} and connection_id=${connectionId} order by updated_at desc limit 100`,
      );
      return rows.map((r) => FanpageComment.parse(r.document));
    });
  }
  page(
    ws: WorkspaceId,
    connectionId: string,
    input: { limit: number; after: CommentPosition | null; postId?: string; q?: string },
  ) {
    return withTenant(this.db, ws, async (tx) => {
      const where = [sql`workspace_id=${ws}`, sql`connection_id=${connectionId}`];
      if (input.postId) where.push(sql`document->>'postId'=${input.postId}`);
      if (input.q)
        where.push(
          sql`(document->>'text' ilike ${likePattern(input.q)} or document->>'authorId'=${input.q})`,
        );
      if (input.after)
        where.push(
          sql`(updated_at, comment_id) < (${input.after.activityAt}::timestamptz, ${input.after.commentId})`,
        );
      const rows = await tx.execute<{ document: unknown; activity: string; comment_id: string }>(
        sql`select document, ${activity} as activity, comment_id from fanpage_comments where ${sql.join(where, sql` and `)} order by updated_at desc, comment_id desc limit ${input.limit}`,
      );
      return rows.map((r) => ({
        comment: FanpageComment.parse(r.document),
        position: { activityAt: r.activity, commentId: r.comment_id },
      }));
    });
  }
  get(ws: WorkspaceId, connectionId: string, commentId: string) {
    return withTenant(this.db, ws, async (tx) => {
      const rows = await tx.execute<{ document: unknown }>(
        sql`select document from fanpage_comments where workspace_id=${ws} and connection_id=${connectionId} and comment_id=${commentId}`,
      );
      return rows[0] ? FanpageComment.parse(rows[0].document) : null;
    });
  }
  posts(
    ws: WorkspaceId,
    connectionId: string,
    input: { limit: number; after: PostPosition | null },
  ) {
    return withTenant(this.db, ws, async (tx) => {
      const after = input.after
        ? sql`having (max(updated_at), document->>'postId') < (${input.after.activityAt}::timestamptz, ${input.after.postId})`
        : sql``;
      const rows = await tx.execute<{
        post_id: string;
        comments: number;
        activity: string;
        context: unknown;
      }>(
        sql`select document->>'postId' as post_id, count(*)::int as comments, ${postActivity} as activity,
          (array_agg(document->'context' order by updated_at desc) filter (where jsonb_typeof(document->'context')='object'))[1] as context
          from fanpage_comments where workspace_id=${ws} and connection_id=${connectionId}
          group by 1 ${after} order by max(updated_at) desc, 1 desc limit ${input.limit}`,
      );
      return rows.map((r): StoredCommentPost => ({
        postId: r.post_id,
        comments: Number(r.comments),
        lastActivityAt: r.activity,
        context: r.context ? FanpageComment.shape.context.parse(r.context) : null,
      }));
    });
  }
  change<T>(
    ws: WorkspaceId,
    connectionId: string,
    commentId: string,
    fn: (current: FanpageComment | null) => { comment: FanpageComment | null; result: T },
  ): Promise<T> {
    return withTenant(this.db, ws, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${ws}/${connectionId}/${commentId}`},0))`,
      );
      const rows = await tx.execute<{ document: unknown }>(
        sql`select document from fanpage_comments where workspace_id=${ws} and connection_id=${connectionId} and comment_id=${commentId} for update`,
      );
      const { comment, result } = fn(rows[0] ? FanpageComment.parse(rows[0].document) : null);
      if (comment)
        await tx.execute(sql`insert into fanpage_comments(workspace_id,connection_id,comment_id,document) values(${ws},${connectionId},${commentId},${JSON.stringify(comment)}::jsonb)
        on conflict(connection_id,comment_id) do update set document=excluded.document, updated_at=now() where fanpage_comments.workspace_id=${ws}`);
      return result;
    });
  }
}
export class UnavailableFanpageStore implements FanpageStore {
  private fail(): never {
    throw new ChannelError('UNAVAILABLE', 'Fanpage storage requires a database');
  }
  privateComments(): Promise<FanpageComment[]> {
    return this.fail();
  }
  interrupted(): Promise<boolean> {
    return this.fail();
  }
  settings(): Promise<FanpageSettings> {
    return this.fail();
  }
  saveSettings(): Promise<void> {
    return this.fail();
  }
  list(): Promise<FanpageComment[]> {
    return this.fail();
  }
  page(): Promise<{ comment: FanpageComment; position: CommentPosition }[]> {
    return this.fail();
  }
  get(): Promise<FanpageComment | null> {
    return this.fail();
  }
  posts(): Promise<StoredCommentPost[]> {
    return this.fail();
  }
  change<T>(): Promise<T> {
    return this.fail();
  }
}
