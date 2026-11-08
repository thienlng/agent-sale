import type { WorkspaceId } from '@agent-sales/shared';
import { sql } from 'drizzle-orm';

import type { Database } from './client.js';
import { withTenant } from './tenant.js';

/** Same shape as `ExportTable` in @agent-sales/contracts (structural; db does not import contracts). */
export type ExportCell = string | number | boolean | bigint | Date | null | object;
export interface ExportTable {
  file: string;
  columns: readonly string[];
  rows(): AsyncIterable<readonly ExportCell[][]>;
  mediaColumns?: readonly string[];
}

/** One column of an export file: its header and a SQL expression over the table alias `t`. */
export interface ExportColumn {
  header: string;
  sql: string;
  /** A timestamptz: written as ISO 8601 UTC (`2026-11-08T15:09:16Z`). */
  time?: boolean;
}

function columnSql(c: ExportColumn): string {
  return c.time ? `to_char((${c.sql}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` : c.sql;
}

/**
 * A workspace export file read from one table (SET-10). Only the owning module declares one,
 * for its own table; `table`, `columns[].sql` and `where` are constants written in code, never
 * input. Rows come in pages ordered by the uuid `id`, each page in its own short tenant
 * transaction (RLS) and also filtered on `t.workspace_id`.
 */
export interface ExportTableSpec {
  file: string;
  table: string;
  columns: readonly ExportColumn[];
  /** Extra condition over `t` (e.g. `t.deleted_at is null`). */
  where?: string;
  mediaColumns?: readonly string[];
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

export function exportTable(
  db: Database,
  workspaceId: WorkspaceId,
  spec: ExportTableSpec,
  pageSize = 500,
): ExportTable {
  if (!IDENT.test(spec.table)) throw new Error(`exportTable: bad table name ${spec.table}`);
  const select = spec.columns.map((c, i) => `${columnSql(c)} as c${i}`).join(', ');
  const extra = spec.where ? ` and (${spec.where})` : '';
  const width = spec.columns.length;
  return {
    file: spec.file,
    columns: spec.columns.map((c) => c.header),
    ...(spec.mediaColumns ? { mediaColumns: spec.mediaColumns } : {}),
    async *rows() {
      let after: string | null = null;
      for (;;) {
        const last: string | null = after;
        const page: readonly Record<string, unknown>[] = await withTenant(
          db,
          workspaceId,
          async (tx): Promise<readonly Record<string, unknown>[]> =>
            await tx.execute<Record<string, unknown>>(
              sql`select ${sql.raw(select)}, t.id::text as k from ${sql.raw(spec.table)} t
                where t.workspace_id = ${workspaceId}
                  and (${last}::uuid is null or t.id > ${last}::uuid)${sql.raw(extra)}
                order by t.id limit ${pageSize}`,
            ),
        );
        if (page.length === 0) return;
        yield page.map((r) => {
          const row: ExportCell[] = [];
          for (let i = 0; i < width; i++) row.push((r[`c${i}`] ?? null) as ExportCell);
          return row;
        });
        if (page.length < pageSize) return;
        after = String(page[page.length - 1]?.['k']);
      }
    },
  };
}
