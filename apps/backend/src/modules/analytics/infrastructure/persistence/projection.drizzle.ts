import { and, asc, type Database, eq, gt, schema, sql, withSystem } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type { FactDraft, OutboxRow } from '../../domain/fact.js';
import type {
  ProjectionHealth,
  ProjectionLease,
  ProjectionStore,
} from '../../domain/ports/projection.js';

const CONSUMER = 'analytics.projector';
const LOCK_KEY = 'analytics.projector';
const o = schema.outboxEvents;
const CHUNK = 500;

const toRow = (r: typeof o.$inferSelect): OutboxRow => ({
  id: r.id,
  workspaceId: r.workspaceId,
  type: r.type,
  aggregateId: r.aggregateId,
  payload: r.payload,
  createdAt: r.createdAt,
});

const xid = (n: number) => sql`${String(n)}::xid8`;

/**
 * Rows written by transactions that finished between two horizons (`from` ≤ tx < `to`).
 *
 * Why a horizon and not "ids below the oldest running transaction": ids are taken at insert and
 * become visible at commit, so an id can commit after a higher one. Every transaction with an id
 * below the horizon (the oldest still-running one) has finished, so the rows of those transactions
 * are all visible and none can appear later; the next pass starts exactly at `to`. `tx_id` is the
 * 64-bit transaction id (it never wraps) and is indexed, so a pass reads only its window and a
 * rebuild from 0 reaches the oldest row.
 */
function inWindow(from: number, to: number) {
  return sql`${o.txId} >= ${xid(from)} and ${o.txId} < ${xid(to)}`;
}

/** Cross-tenant reads of the outbox and the checkpoint (app_system). */
export class DrizzleProjectionStore implements ProjectionStore {
  constructor(private readonly systemDb: Database) {}

  withLease<T>(fn: (lease: ProjectionLease) => Promise<T | null>): Promise<T | null> {
    return withSystem(this.systemDb, async (tx) => {
      const got = await tx.execute<{ ok: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) as ok`,
      );
      if (!got[0]?.ok) return null;
      const [cp] = await tx
        .select({ horizon: schema.analyticsCheckpoints.horizon })
        .from(schema.analyticsCheckpoints)
        .where(eq(schema.analyticsCheckpoints.consumer, CONSUMER));
      const from = cp?.horizon ?? 0;
      const [h] = await tx.execute<{ h: string }>(
        sql`select pg_snapshot_xmin(pg_current_snapshot())::text::bigint as h`,
      );
      const to = Number(h?.h ?? 0);

      return fn({
        async readBatch(afterId, limit) {
          if (to <= from) return [];
          const rows = await tx
            .select()
            .from(o)
            .where(and(gt(o.id, afterId), inWindow(from, to)))
            .orderBy(asc(o.id))
            .limit(limit);
          return rows.map(toRow);
        },
        async commit() {
          if (to <= from) return;
          await tx
            .insert(schema.analyticsCheckpoints)
            .values({ consumer: CONSUMER, horizon: to })
            .onConflictDoUpdate({
              target: schema.analyticsCheckpoints.consumer,
              set: { horizon: to, updatedAt: new Date() },
            });
        },
        async deadLetter(row, error) {
          await tx
            .insert(schema.analyticsDeadLetters)
            .values({ outboxId: row.id, workspaceId: row.workspaceId, type: row.type, error })
            .onConflictDoNothing();
        },
        async readWorkspace(ws: WorkspaceId, afterId, limit) {
          const rows = await tx
            .select()
            .from(o)
            .where(and(eq(o.workspaceId, ws), gt(o.id, afterId), sql`${o.txId} < ${xid(to)}`))
            .orderBy(asc(o.id))
            .limit(limit);
          return rows.map(toRow);
        },
        async replaceFacts(ws: WorkspaceId, facts: readonly FactDraft[]) {
          await tx.delete(schema.analyticsFacts).where(eq(schema.analyticsFacts.workspaceId, ws));
          for (let i = 0; i < facts.length; i += CHUNK) {
            await tx
              .insert(schema.analyticsFacts)
              .values(facts.slice(i, i + CHUNK).map((f) => ({ ...f })))
              .onConflictDoNothing();
          }
        },
      });
    });
  }

  health(): Promise<ProjectionHealth> {
    return withSystem(this.systemDb, async (tx) => {
      const [cp] = await tx
        .select({
          horizon: schema.analyticsCheckpoints.horizon,
          at: schema.analyticsCheckpoints.updatedAt,
        })
        .from(schema.analyticsCheckpoints)
        .where(eq(schema.analyticsCheckpoints.consumer, CONSUMER));
      const [mark] = await tx.execute<{ id: string | null }>(
        sql`select max(id) as id from analytics_facts`,
      );
      // Not yet projected = written by a transaction at or above the last horizon (the horizon is
      // the oldest transaction still running then). Only committed rows are visible here.
      const horizon = cp?.horizon ?? 0;
      const [oldest] = await tx.execute<{ at: Date | string | null }>(
        sql`select min(created_at) as at from outbox_events where tx_id >= ${xid(horizon)}`,
      );
      const waiting = oldest?.at ? new Date(oldest.at) : null;
      return {
        watermarkId: Number(mark?.id ?? 0),
        watermarkAt: cp?.at ?? null,
        lagSeconds: waiting ? Math.max(0, Math.round((Date.now() - waiting.getTime()) / 1000)) : 0,
      };
    });
  }
}
