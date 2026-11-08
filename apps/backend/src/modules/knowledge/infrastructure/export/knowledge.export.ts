import type { ExportTable, WorkspaceExportSource } from '@agent-sales/contracts';
import { exportTable, type Database } from '@agent-sales/db';
import { workspaceId } from '@agent-sales/shared';

/**
 * The knowledge module's part of the workspace data export (SET-10): FAQ entries and training
 * materials (scenarios, quick replies, media and their folders) per bot. The folded search text
 * is left out.
 */
export class KnowledgeExportSource implements WorkspaceExportSource {
  constructor(private readonly db: Database | null) {}

  exportTables(ws: string): readonly ExportTable[] {
    const db = this.db;
    if (!db) return [];
    const id = workspaceId(ws);
    return [
      exportTable(db, id, {
        file: 'knowledge_items.csv',
        table: 'knowledge_items',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'bot_id', sql: 't.bot_id' },
          { header: 'type', sql: 't.type' },
          { header: 'question', sql: 't.question' },
          { header: 'answer', sql: 't.answer' },
          { header: 'source', sql: 't.source' },
          { header: 'created_at', sql: 't.created_at', time: true },
          { header: 'updated_at', sql: 't.updated_at', time: true },
        ],
      }),
      exportTable(db, id, {
        file: 'training_items.csv',
        table: 'training_items',
        mediaColumns: ['media_url'],
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'bot_id', sql: 't.bot_id' },
          { header: 'kind', sql: 't.kind' },
          { header: 'section', sql: 't.section' },
          { header: 'title', sql: 't.title' },
          { header: 'content', sql: 't.content' },
          { header: 'trigger', sql: 't.trigger' },
          { header: 'notes', sql: 't.notes' },
          { header: 'enabled', sql: 't.enabled' },
          { header: 'media_url', sql: 't.media_url' },
          { header: 'folder_id', sql: 't.folder_id' },
          {
            header: 'folder',
            sql: '(select f.title from training_items f where f.id = t.folder_id)',
          },
          { header: 'created_at', sql: 't.created_at', time: true },
          { header: 'updated_at', sql: 't.updated_at', time: true },
        ],
      }),
    ];
  }
}
