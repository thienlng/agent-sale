import { and, asc, type Database, eq, gt, schema, sql, withSystem } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type { OutboxRow } from '../../domain/fact.js';
import type { ProjectionLease, ProjectionStore } from '../../domain/ports/projection.js';

const CONSUMER = 'analytics.projector';
const LOCK_KEY = 'analytics.projector';
const o = schema.outboxEvents;

/**
 * An outbox row is only safe to read when no transaction that started before it can still
 * commit a lower id (ids are handed out at insert, rows become visible at commit).
 */
const settled = sql`${o.id} in (select id from outbox_events where xmin::text::bigint < pg_snapshot_xmin(pg_current_snapshot())::text::bigint)`;

const toRow = (r: typeof o.$inferSelect): OutboxRow => ({
  id: r.id,
  workspaceId: r.workspaceId,
  type: r.type,
  aggregateId: r.aggregateId,
  payload: r.payload,
  createdAt: r.createdAt,
});

/** Cross-tenant reads of the outbox and the checkpoint (app_system). */
export class DrizzleProjectionStore implements ProjectionStore {
  constructor(private readonly systemDb: Database) {}

  withLease<T>(fn: (lease: ProjectionLease) => Promise<T | null>): Promise<T | null> {
    return withSystem(this.systemDb, async (tx) => {
      const got = await tx.execute<{ ok: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) as ok`,
      );
      if (!got[0]?.ok) return null;
      return fn({
        async checkpoint() {
          const [r] = await tx
            .select({ id: schema.analyticsCheckpoints.lastOutboxId })
            .from(schema.analyticsCheckpoints)
            .where(eq(schema.analyticsCheckpoints.consumer, CONSUMER));
          return r?.id ?? 0;
        },
        async readBatch(afterId, limit) {
          const rows = await tx
            .select()
            .from(o)
            .where(and(gt(o.id, afterId), settled))
            .orderBy(asc(o.id))
            .limit(limit);
          return rows.map(toRow);
        },
        async commit(lastId) {
          await tx
            .insert(schema.analyticsCheckpoints)
            .values({ consumer: CONSUMER, lastOutboxId: lastId })
            .onConflictDoUpdate({
              target: schema.analyticsCheckpoints.consumer,
              set: { lastOutboxId: lastId, updatedAt: new Date() },
            });
        },
        async deadLetter(row, error) {
          await tx
            .insert(schema.analyticsDeadLetters)
            .values({ outboxId: row.id, workspaceId: row.workspaceId, type: row.type, error })
            .onConflictDoNothing();
        },
      });
    });
  }

  health() {
    return withSystem(this.systemDb, async (tx) => {
      const [cp] = await tx
        .select({ id: schema.analyticsCheckpoints.lastOutboxId })
        .from(schema.analyticsCheckpoints)
        .where(eq(schema.analyticsCheckpoints.consumer, CONSUMER));
      const watermarkId = cp?.id ?? 0;
      const [mark] = watermarkId
        ? await tx.select({ at: o.createdAt }).from(o).where(eq(o.id, watermarkId))
        : [];
      const [oldest] = await tx
        .select({ at: o.createdAt })
        .from(o)
        .where(gt(o.id, watermarkId))
        .orderBy(asc(o.id))
        .limit(1);
      // Lag is how long the oldest event still waiting has been waiting; none waiting is 0.
      const lagSeconds = oldest
        ? Math.max(0, Math.round((Date.now() - oldest.at.getTime()) / 1000))
        : 0;
      return { watermarkId, watermarkAt: mark?.at ?? null, lagSeconds };
    });
  }

  readWorkspace(ws: WorkspaceId, afterId: number, limit: number) {
    return withSystem(this.systemDb, async (tx) =>
      (
        await tx
          .select()
          .from(o)
          .where(and(eq(o.workspaceId, ws), gt(o.id, afterId)))
          .orderBy(asc(o.id))
          .limit(limit)
      ).map(toRow),
    );
  }

  async deleteFacts(ws: WorkspaceId): Promise<void> {
    await withSystem(this.systemDb, (tx) =>
      tx.delete(schema.analyticsFacts).where(eq(schema.analyticsFacts.workspaceId, ws)),
    );
  }
}
