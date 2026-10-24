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
const TWO32 = 4294967296;
/** A window longer than this cannot be told apart from the future with 32-bit xids. */
const MAX_SPAN = 2147483647;

const toRow = (r: typeof o.$inferSelect): OutboxRow => ({
  id: r.id,
  workspaceId: r.workspaceId,
  type: r.type,
  aggregateId: r.aggregateId,
  payload: r.payload,
  createdAt: r.createdAt,
});

/**
 * Rows written by transactions that finished between two horizons (`from` ≤ xid < `to`).
 *
 * Why a horizon and not "ids below the oldest running transaction": ids are taken at insert and
 * become visible at commit, so an id can commit after a higher one. Every transaction with an xid
 * below the horizon (the oldest still-running one) has finished, so the rows of those transactions
 * are all visible and none can appear later; the next pass starts exactly at `to`. A row's `xmin` is
 * a 32-bit xid while the horizon is a 64-bit xid8: compare by distance back from the horizon, which
 * survives xid wraparound. `from = 0` means "from the beginning" (first run, or a rebuild).
 */
function inWindow(from: number, to: number) {
  const span = from > 0 ? Math.min(to - from, MAX_SPAN) : MAX_SPAN;
  const back = sql`((${to % TWO32}::bigint - xmin::text::bigint + ${TWO32}::bigint) % ${TWO32}::bigint)`;
  return sql`${back} between 1 and ${span}::bigint`;
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
            .where(and(eq(o.workspaceId, ws), gt(o.id, afterId), inWindow(0, to)))
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
      // Not yet projected = the transaction had not finished at the last horizon. A row whose xid
      // equals the horizon is not settled either (the horizon is the oldest running transaction).
      const horizon = cp?.horizon ?? 0;
      const [oldest] = await tx.execute<{ at: Date | string | null }>(
        sql`select min(created_at) as at from outbox_events
            where not (((${horizon % TWO32}::bigint - xmin::text::bigint + ${TWO32}::bigint) % ${TWO32}::bigint)
              between 1 and ${MAX_SPAN}::bigint)`,
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
