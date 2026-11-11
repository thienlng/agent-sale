import type { ExportTable, WorkspaceExportSource } from '@agent-sales/contracts';
import { exportTable, type Database } from '@agent-sales/db';
import { workspaceId } from '@agent-sales/shared';

/**
 * The crm module's part of the workspace data export (SET-10): customers, notes, history
 * (requests recorded by bots are history entries), tag assignments and tasks (CRM-04). Internal
 * search text, sync and reminder bookkeeping and versions are left out.
 */
export class CrmExportSource implements WorkspaceExportSource {
  constructor(private readonly db: Database | null) {}

  exportTables(ws: string): readonly ExportTable[] {
    const db = this.db;
    if (!db) return [];
    const id = workspaceId(ws);
    return [
      exportTable(db, id, {
        file: 'customers.csv',
        table: 'contacts',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'name', sql: 't.name' },
          { header: 'phone', sql: 't.phone' },
          { header: 'email', sql: 't.email' },
          { header: 'birthday', sql: 't.birthday::text' },
          { header: 'gender', sql: 't.gender' },
          { header: 'address', sql: 't.address' },
          { header: 'province', sql: 't.province' },
          { header: 'ward', sql: 't.ward' },
          { header: 'source', sql: '(select s.name from crm_sources s where s.id = t.source_id)' },
          {
            header: 'first_source',
            sql: '(select s.name from crm_sources s where s.id = t.first_source_id)',
          },
          { header: 'status', sql: '(select s.name from crm_statuses s where s.id = t.status_id)' },
          { header: 'sales_user_id', sql: 't.sales_user_id' },
          { header: 'care_user_id', sql: 't.care_user_id' },
          { header: 'profile_note', sql: 't.profile_note' },
          { header: 'ad_ref', sql: 't.ad_ref' },
          { header: 'external_source', sql: 't.external_source' },
          { header: 'external_id', sql: 't.external_id' },
          { header: 'created_at', sql: 't.created_at', time: true },
          { header: 'updated_at', sql: 't.updated_at', time: true },
          { header: 'archived_at', sql: 't.archived_at', time: true },
        ],
      }),
      exportTable(db, id, {
        file: 'customer_notes.csv',
        table: 'contact_notes',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'customer_id', sql: 't.contact_id' },
          { header: 'body', sql: 't.body' },
          { header: 'author', sql: 't.author_name' },
          { header: 'created_at', sql: 't.created_at', time: true },
          { header: 'edited_at', sql: 't.edited_at', time: true },
        ],
      }),
      exportTable(db, id, {
        file: 'customer_history.csv',
        table: 'contact_history',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'customer_id', sql: 't.contact_id' },
          { header: 'type', sql: 't.type' },
          { header: 'changes', sql: 't.changes' },
          { header: 'data', sql: 't.data' },
          { header: 'actor', sql: 't.actor_name' },
          { header: 'created_at', sql: 't.created_at', time: true },
        ],
      }),
      exportTable(db, id, {
        file: 'customer_tags.csv',
        table: 'crm_tag_assignments',
        where: 't.removed_at is null',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'tag', sql: '(select g.name from crm_tags g where g.id = t.tag_id)' },
          { header: 'scope', sql: 't.scope' },
          { header: 'entity_id', sql: 't.entity_id' },
          { header: 'values', sql: 't.values' },
          { header: 'assigned_by', sql: 't.assigned_by_name' },
          { header: 'assigned_at', sql: 't.assigned_at', time: true },
        ],
      }),
      exportTable(db, id, {
        file: 'tasks.csv',
        table: 'tasks',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'title', sql: 't.title' },
          { header: 'note', sql: 't.note' },
          { header: 'status', sql: 't.status' },
          { header: 'due_at', sql: 't.due_at', time: true },
          { header: 'assignee_kind', sql: 't.assignee_kind' },
          { header: 'assignee_user_id', sql: 't.assignee_user_id' },
          { header: 'customer_id', sql: 't.contact_id' },
          { header: 'conversation_id', sql: 't.conversation_id' },
          { header: 'subject_type', sql: 't.subject_type' },
          { header: 'subject_id', sql: 't.subject_id' },
          { header: 'source', sql: 't.source' },
          { header: 'created_by', sql: 't.created_by' },
          { header: 'created_at', sql: 't.created_at', time: true },
          { header: 'done_at', sql: 't.done_at', time: true },
          { header: 'done_by', sql: 't.done_by' },
        ],
      }),
    ];
  }
}
