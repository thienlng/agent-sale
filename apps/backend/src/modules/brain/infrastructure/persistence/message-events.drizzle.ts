import {
  and,
  asc,
  type Database,
  eq,
  gt,
  isNotNull,
  schema,
  sql,
  withSystem,
} from '@agent-sales/db';
import { workspaceId as asWorkspaceId } from '@agent-sales/shared';

import type { MessageEventLease, MessageEventSource } from '../../domain/ports/brain.store.js';

const CONSUMER = 'brain.signals';
const EVENT = 'conversation.message.received.v1';
const o = schema.outboxEvents;
/**
 * The consumer position. Consumers of the outbox keep one row each in a consumer-keyed checkpoint
 * table; migration 0072 added no table for the brain, so it keeps its row (`brain.signals`) in
 * the platform's `analytics_checkpoints` (app_system only) next to the analytics projector's.
 */
const cp = schema.analyticsCheckpoints;

const xid = (n: number) => sql`${String(n)}::xid8`;

/**
 * Reads new customer-message events the way the analytics projector reads the outbox: under an
 * exclusive advisory lock, the rows of the transactions that finished between the last horizon
 * and the oldest transaction still running (`DrizzleProjectionStore` explains why). The first pass
 * of a fresh install starts at the current horizon: past messages are never evaluated in bulk.
 */
export class DrizzleMessageEventSource implements MessageEventSource {
  constructor(private readonly systemDb: Database) {}

  withLease<T>(fn: (lease: MessageEventLease) => Promise<T>): Promise<T | null> {
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
      return fn({
        async readBatch(afterId, limit) {
          if (to <= from) return [];
          const rows = await tx
            .select({
              id: o.id,
              workspaceId: o.workspaceId,
              aggregateId: o.aggregateId,
              payload: o.payload,
              createdAt: o.createdAt,
            })
            .from(o)
            .where(
              and(
                gt(o.id, afterId),
                eq(o.type, EVENT),
                isNotNull(o.workspaceId),
                sql`${o.txId} >= ${xid(from)} and ${o.txId} < ${xid(to)}`,
              ),
            )
            .orderBy(asc(o.id))
            .limit(limit);
          return rows.map((r) => ({
            id: r.id,
            workspaceId: asWorkspaceId(r.workspaceId ?? ''),
            conversationId: r.aggregateId,
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
