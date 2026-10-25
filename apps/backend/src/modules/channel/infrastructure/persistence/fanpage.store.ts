import type { NormalizedEvent } from '@agent-sales/channels';
import { interruptsComment } from '../../domain/comment-interruption.js';
import { sql, withTenant, type Database } from '@agent-sales/db';
import { FanpageSettings, FanpageComment } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import type { FanpageStore } from '../../application/ports/fanpage-store.js';
import { ChannelError } from '../../domain/channel.errors.js';
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
  change<T>(): Promise<T> {
    return this.fail();
  }
}
