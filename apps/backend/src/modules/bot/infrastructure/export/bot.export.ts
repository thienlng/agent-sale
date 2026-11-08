import type { ExportTable, WorkspaceExportSource } from '@agent-sales/contracts';
import { exportTable, type Database } from '@agent-sales/db';
import { workspaceId } from '@agent-sales/shared';

/**
 * The bot module's part of the workspace data export (SET-10): the bots and the configuration the
 * owner wrote (`settings`, validated by contracts `BotSettings`; it holds no channel tokens or
 * secrets — those live in the channel module). Deleted bots are left out.
 */
export class BotExportSource implements WorkspaceExportSource {
  constructor(private readonly db: Database | null) {}

  exportTables(ws: string): readonly ExportTable[] {
    const db = this.db;
    if (!db) return [];
    const id = workspaceId(ws);
    return [
      exportTable(db, id, {
        file: 'bots.csv',
        table: 'bots',
        where: 't.deleted_at is null',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'name', sql: 't.name' },
          { header: 'industry', sql: 't.industry' },
          { header: 'status', sql: "case when t.is_active then 'active' else 'paused' end" },
          { header: 'catalog_mode', sql: 't.catalog_mode' },
          { header: 'order_taking', sql: 't.order_taking' },
          { header: 'order_shipping_fee_vnd', sql: 't.order_shipping_fee_vnd' },
          { header: 'mission', sql: "t.settings->>'mission'" },
          { header: 'greeting', sql: "t.settings->>'greeting'" },
          { header: 'profile', sql: "t.settings->'profile'" },
          { header: 'settings', sql: 't.settings' },
          { header: 'created_at', sql: 't.created_at', time: true },
          { header: 'updated_at', sql: 't.updated_at', time: true },
        ],
      }),
    ];
  }
}
