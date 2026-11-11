import type { ExportTable, WorkspaceExportSource } from '@agent-sales/contracts';
import { exportTable, type Database } from '@agent-sales/db';
import { workspaceId } from '@agent-sales/shared';

/**
 * The care module's part of the workspace data export (SET-10): every message the care agent
 * wrote (drafts, sends, skips and the people's decisions) and the follow-up cycles. Settings,
 * the daily counter and the outbox position are left out (spec §7: "exported except usage").
 */
export class CareExportSource implements WorkspaceExportSource {
  constructor(private readonly db: Database | null) {}

  exportTables(ws: string): readonly ExportTable[] {
    const db = this.db;
    if (!db) return [];
    return [
      exportTable(db, workspaceId(ws), {
        file: 'care_messages.csv',
        table: 'care_messages',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'conversation_id', sql: 't.conversation_id' },
          { header: 'enrollment_id', sql: 't.enrollment_id' },
          { header: 'template', sql: 't.template' },
          { header: 'step', sql: 't.step' },
          { header: 'level', sql: 't.level' },
          { header: 'status', sql: 't.status' },
          { header: 'text', sql: 't.text' },
          { header: 'skip_reason', sql: 't.skip_reason' },
          { header: 'window_closes_at', sql: 't.window_closes_at', time: true },
          { header: 'sent_message_id', sql: 't.sent_message_id' },
          { header: 'sent_at', sql: 't.sent_at', time: true },
          { header: 'decided_by', sql: 't.decided_by' },
          { header: 'decided_at', sql: 't.decided_at', time: true },
          { header: 'created_at', sql: 't.created_at', time: true },
        ],
      }),
      exportTable(db, workspaceId(ws), {
        file: 'care_enrollments.csv',
        table: 'care_enrollments',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'conversation_id', sql: 't.conversation_id' },
          { header: 'template', sql: 't.template' },
          { header: 'step', sql: 't.step' },
          { header: 'status', sql: 't.status' },
          { header: 'stop_reason', sql: 't.stop_reason' },
          { header: 'anchor_at', sql: 't.anchor_at', time: true },
          { header: 'next_at', sql: 't.next_at', time: true },
          { header: 'created_at', sql: 't.created_at', time: true },
          { header: 'updated_at', sql: 't.updated_at', time: true },
        ],
      }),
    ];
  }
}
