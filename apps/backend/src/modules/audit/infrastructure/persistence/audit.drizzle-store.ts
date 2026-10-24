import { and, type Database, desc, eq, schema, sql, withTenant } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type { AuditFilter, AuditStore } from '../../application/ports/audit-store.js';

const e = schema.auditEvents;
/** The cursor travels as a JS Date (ms), so order and compare at ms: no row falls between two pages. */
const at = sql`date_trunc('milliseconds', ${e.createdAt})`;
const likePrefix = (p: string) => `${p.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Reads the audit trail under tenant RLS (the table is append-only for the app role). */
export class DrizzleAuditStore implements AuditStore {
  constructor(private readonly db: Database) {}

  list(ws: WorkspaceId, f: AuditFilter) {
    return withTenant(this.db, ws, async (tx) => {
      const rows = await tx
        .select()
        .from(e)
        .where(
          and(
            f.action
              ? f.action.endsWith('.')
                ? sql`${e.action} like ${likePrefix(f.action)} escape '\\'`
                : eq(e.action, f.action)
              : undefined,
            f.from ? sql`${e.createdAt} >= ${f.from.toISOString()}` : undefined,
            f.to ? sql`${e.createdAt} < ${f.to.toISOString()}` : undefined,
            f.before
              ? sql`(${at}, ${e.id}) < (${f.before.at.toISOString()}::timestamptz, ${f.before.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(sql`${at} desc`, desc(e.id))
        .limit(f.limit);
      return rows.map((r) => ({
        id: r.id,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        actorName: r.actorName,
        data: r.data,
        createdAt: r.createdAt,
      }));
    });
  }
}
