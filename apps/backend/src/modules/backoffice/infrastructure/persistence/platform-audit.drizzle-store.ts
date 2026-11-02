import { and, type Database, desc, eq, schema, sql, withSystem } from '@agent-sales/db';

import type {
  PlatformAuditFilter,
  PlatformAuditStore,
} from '../../application/ports/platform-audit-store.js';

const e = schema.platformAuditEvents;
/** The cursor travels as a JS Date (ms), so order and compare at ms: no row falls between two pages. */
const at = sql`date_trunc('milliseconds', ${e.createdAt})`;

/** Global table, read as app_system (the tenant role has no grant on it). */
export class DrizzlePlatformAuditStore implements PlatformAuditStore {
  constructor(private readonly db: Database) {}

  list(f: PlatformAuditFilter) {
    return withSystem(this.db, async (tx) => {
      const rows = await tx
        .select()
        .from(e)
        .where(
          and(
            f.targetType ? eq(e.targetType, f.targetType) : undefined,
            f.targetId ? eq(e.targetId, f.targetId) : undefined,
            f.before
              ? sql`(${at}, ${e.id}) < (${f.before.at.toISOString()}::timestamptz, ${f.before.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(sql`${at} desc`, desc(e.id))
        .limit(f.limit);
      return rows.map((r) => ({
        id: r.id,
        actorName: r.actorName,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        reason: r.reason,
        data: r.data,
        createdAt: r.createdAt,
      }));
    });
  }
}
