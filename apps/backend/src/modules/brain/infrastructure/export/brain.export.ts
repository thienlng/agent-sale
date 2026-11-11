import type { ExportTable, WorkspaceExportSource } from '@agent-sales/contracts';
import { exportTable, type Database } from '@agent-sales/db';
import { workspaceId } from '@agent-sales/shared';

/**
 * The brain module's part of the workspace data export (SET-10): one row per conversation with
 * what the AI understood about it. `conversation_signals` has no `id` (PK `(workspace_id,
 * conversation_id)`), so pages are keyed by `conversation_id`. Operational tables (`signal_jobs`,
 * `signal_runs`, `signal_usage`, `brain_settings`), the dismiss marker and versions are left out.
 */
export class BrainExportSource implements WorkspaceExportSource {
  constructor(private readonly db: Database | null) {}

  exportTables(ws: string): readonly ExportTable[] {
    const db = this.db;
    if (!db) return [];
    return [
      exportTable(db, workspaceId(ws), {
        file: 'conversation_signals.csv',
        table: 'conversation_signals',
        key: 'conversation_id',
        columns: [
          { header: 'conversation_id', sql: 't.conversation_id' },
          { header: 'customer_id', sql: 't.contact_id' },
          { header: 'stage', sql: 't.stage' },
          { header: 'stage_locked', sql: 't.stage_locked' },
          { header: 'intent', sql: 't.intent' },
          { header: 'mood', sql: 't.mood' },
          { header: 'needs_human', sql: 't.needs_human' },
          { header: 'needs_human_reason', sql: 't.needs_human_reason' },
          { header: 'follow_up_at', sql: 't.follow_up_at', time: true },
          { header: 'follow_up_reason', sql: 't.follow_up_reason' },
          { header: 'note', sql: 't.note' },
          { header: 'evaluated_until', sql: 't.evaluated_until', time: true },
          { header: 'evaluated_at', sql: 't.evaluated_at', time: true },
          { header: 'updated_at', sql: 't.updated_at', time: true },
        ],
      }),
    ];
  }
}
