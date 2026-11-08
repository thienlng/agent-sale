import type { ExportTable, WorkspaceExportSource } from '@agent-sales/contracts';
import { exportTable, type Database } from '@agent-sales/db';
import { workspaceId } from '@agent-sales/shared';

/** URLs of a message's attachments as a JSON array (for copying the files into `media/`). */
const ATTACHMENT_URLS = `(select coalesce(jsonb_agg(a->>'url'), '[]'::jsonb)
  from jsonb_array_elements(coalesce(t.data->'attachments', '[]'::jsonb)) a)`;

/**
 * The conversation module's part of the workspace data export (SET-10): conversations and their
 * messages. Both tables keep a `data` document; the columns read the fields a shop owner needs.
 * Read markers, revisions and idempotency keys are left out.
 */
export class ConversationExportSource implements WorkspaceExportSource {
  constructor(private readonly db: Database | null) {}

  exportTables(ws: string): readonly ExportTable[] {
    const db = this.db;
    if (!db) return [];
    const id = workspaceId(ws);
    return [
      exportTable(db, id, {
        file: 'conversations.csv',
        table: 'conversations',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'channel_id', sql: 't.channel_id' },
          { header: 'channel', sql: "t.data->>'provider'" },
          { header: 'customer_platform_id', sql: 't.customer_id' },
          { header: 'customer_name', sql: "t.data->>'customerName'" },
          { header: 'customer_phone', sql: 't.customer_phone' },
          { header: 'customer_id', sql: 't.contact_id' },
          { header: 'bot_id', sql: 't.bot_id' },
          { header: 'mode', sql: 't.mode' },
          { header: 'status', sql: 't.status' },
          { header: 'starred', sql: "coalesce((t.data->>'starred')::boolean, false)" },
          { header: 'assignee_id', sql: 't.assignee_id' },
          { header: 'note', sql: "t.data->>'note'" },
          { header: 'notes', sql: "coalesce(t.data->'notes', '[]'::jsonb)" },
          { header: 'follow_up_at', sql: "(t.data->>'followUpAt')::timestamptz", time: true },
          { header: 'follow_up_note', sql: "t.data->>'followUpNote'" },
          { header: 'last_message', sql: "t.data->>'lastMessage'" },
          {
            header: 'last_inbound_at',
            sql: "(t.data->>'lastInboundAt')::timestamptz",
            time: true,
          },
          { header: 'created_at', sql: 't.created_at', time: true },
          { header: 'updated_at', sql: 't.updated_at', time: true },
        ],
      }),
      exportTable(db, id, {
        file: 'messages.csv',
        table: 'conversation_messages',
        mediaColumns: ['attachment_urls'],
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'conversation_id', sql: 't.conversation_id' },
          { header: 'direction', sql: "t.data->>'direction'" },
          { header: 'sender', sql: "t.data->>'sender'" },
          { header: 'sender_name', sql: "t.data->>'senderName'" },
          { header: 'text', sql: "t.data->>'text'" },
          { header: 'attachments', sql: "coalesce(t.data->'attachments', '[]'::jsonb)" },
          { header: 'attachment_urls', sql: ATTACHMENT_URLS },
          { header: 'status', sql: "t.data->>'status'" },
          { header: 'failure_code', sql: "t.data->>'failureCode'" },
          { header: 'created_at', sql: 't.created_at', time: true },
        ],
      }),
    ];
  }
}
