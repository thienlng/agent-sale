import type { ExportTable, WorkspaceExportSource } from '@agent-sales/contracts';
import { exportTable, type Database } from '@agent-sales/db';
import { workspaceId } from '@agent-sales/shared';

/**
 * The workspace module's part of the workspace data export (SET-10): the business profile (the
 * `workspaces` row, which references itself through `workspace_id`) and the team members. Member
 * names and emails live in `users`, which the tenant role cannot read (migration 0001), so
 * `members.csv` carries user ids only. The logo bytes and invitation link hashes are left out.
 */
export class WorkspaceDataExportSource implements WorkspaceExportSource {
  constructor(private readonly db: Database | null) {}

  exportTables(ws: string): readonly ExportTable[] {
    const db = this.db;
    if (!db) return [];
    const id = workspaceId(ws);
    return [
      exportTable(db, id, {
        file: 'business.csv',
        table: 'workspaces',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'name', sql: 't.name' },
          { header: 'company_name', sql: 't.company_name' },
          { header: 'industry', sql: 't.industry' },
          { header: 'business_services', sql: 't.business_services' },
          { header: 'product_description', sql: 't.product_description' },
          { header: 'timezone', sql: 't.timezone' },
          { header: 'status', sql: 't.status' },
          { header: 'owner_user_id', sql: 't.owner_user_id' },
          { header: 'created_at', sql: 't.created_at', time: true },
          { header: 'updated_at', sql: 't.updated_at', time: true },
          { header: 'profile_updated_at', sql: 't.profile_updated_at', time: true },
        ],
      }),
      exportTable(db, id, {
        file: 'members.csv',
        table: 'members',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'user_id', sql: 't.user_id' },
          { header: 'role', sql: 't.role' },
          { header: 'status', sql: 't.status' },
          { header: 'joined_at', sql: 't.created_at', time: true },
          { header: 'removed_at', sql: 't.removed_at', time: true },
        ],
      }),
    ];
  }
}
