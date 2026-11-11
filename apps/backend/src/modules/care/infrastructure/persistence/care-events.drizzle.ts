import {
  and,
  asc,
  type Database,
  eq,
  gt,
  inArray,
  isNotNull,
  schema,
  sql,
  withSystem,
} from '@agent-sales/db';
import { workspaceId as asWorkspaceId } from '@agent-sales/shared';

import type { CareEventLease, CareEventSource } from '../../domain/ports/care.store.js';

const CONSUMER = 'care.enroll';
const o = schema.outboxEvents;
/** The consumer position: the care module's own `care_checkpoints` row (app_system only). */
const cp = schema.careCheckpoints;

const xid = (n: number) => sql`${String(n)}::xid8`;

/**
 * Reads the outbox events of `types` the way the Brain reads customer messages (and the analytics
 * projector the outbox): under an exclusive advisory lock, the rows of the transactions that
 * finished between the last horizon and the oldest transaction still running. A fresh install
 * starts at the current horizon: past events start no cycle.
 */
export class DrizzleCareEventSource implements CareEventSource {
  constructor(
    private readonly systemDb: Database,
    private readonly types: readonly string[],
  ) {}

  withLease<T>(fn: (lease: CareEventLease) => Promise<T>): Promise<T | null> {
    return withSystem(this.systemDb, async (tx) => {
      const got = await tx.execute<{ ok: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtext(${CONSUMER})) as ok`,
      );
      if (!got[0]?.ok) return null;
      const [row] = await tx
        .select({ horizon: cp.horizon })
        .from(cp)
        .where(eq(cp.consumer, CONSUMER));
      const [hz] = await tx.execute<{ h: string }>(
        sql`select pg_snapshot_xmin(pg_current_snapshot())::text::bigint as h`,
      );
      const to = Number(hz?.h ?? 0);
      const from = row?.horizon ?? to;
      const types = [...this.types];
      return fn({
        async readBatch(afterId, limit) {
          if (to <= from) return [];
          const rows = await tx
            .select({
              id: o.id,
              workspaceId: o.workspaceId,
              type: o.type,
              aggregateId: o.aggregateId,
              payload: o.payload,
              createdAt: o.createdAt,
            })
            .from(o)
            .where(
              and(
                gt(o.id, afterId),
                inArray(o.type, types),
                isNotNull(o.workspaceId),
                sql`${o.txId} >= ${xid(from)} and ${o.txId} < ${xid(to)}`,
              ),
            )
            .orderBy(asc(o.id))
            .limit(limit);
          return rows.map((r) => ({
            id: r.id,
            workspaceId: asWorkspaceId(r.workspaceId ?? ''),
            type: r.type,
            aggregateId: r.aggregateId,
            payload: r.payload,
            createdAt: r.createdAt,
          }));
        },
        async commit() {
          if (row && to <= from) return;
          await tx
            .insert(cp)
            .values({ consumer: CONSUMER, horizon: to })
            .onConflictDoUpdate({
              target: cp.consumer,
              set: { horizon: to, updatedAt: new Date() },
            });
        },
      });
    });
  }
}
