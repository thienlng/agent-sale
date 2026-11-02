import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lte,
  schema,
  sql,
  withSystem,
  withTenant,
  type Database,
  type SQL,
} from '@agent-sales/db';
import type { UserId, WorkspaceId } from '@agent-sales/shared';

import type {
  AttemptOutcome,
  DeliveryRecord,
  DeveloperStore,
  DeveloperSystemStore,
  DispatchLease,
  DueDelivery,
  EndpointRecord,
  PublicOutboxRow,
} from '../../application/ports/developer-store.js';

const CONSUMER = 'developer.webhooks';
const e = schema.webhookEndpoints;
const d = schema.webhookDeliveries;
const o = schema.outboxEvents;
const cp = schema.webhookCheckpoints;

const xid = (n: number) => sql`${String(n)}::xid8`;

const toEndpoint = (r: typeof e.$inferSelect): EndpointRecord => ({
  ...r,
  workspaceId: r.workspaceId as WorkspaceId,
  createdBy: r.createdBy as UserId,
  disabledReason: r.disabledReason ?? null,
});

const toDelivery = (r: typeof d.$inferSelect): DeliveryRecord => ({
  ...r,
  workspaceId: r.workspaceId as WorkspaceId,
});

/** Delivery cursor: `<createdAt ms>.<id>` (base64url), newest first. */
function encodeCursor(r: DeliveryRecord): string {
  return Buffer.from(`${r.createdAt.getTime()}.${r.id}`).toString('base64url');
}
function decodeCursor(cursor: string): { at: Date; id: string } | null {
  const [ms, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('.');
  const at = Number(ms);
  if (!id || !Number.isFinite(at) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { at: new Date(at), id };
}

/** Endpoints and the delivery log, inside the workspace's RLS context. */
export class DrizzleDeveloperStore implements DeveloperStore {
  constructor(private readonly db: Database) {}

  listEndpoints(ws: WorkspaceId): Promise<EndpointRecord[]> {
    return withTenant(this.db, ws, async (tx) =>
      (
        await tx
          .select()
          .from(e)
          .where(eq(e.workspaceId, ws))
          .orderBy(desc(e.createdAt), desc(e.id))
      ).map(toEndpoint),
    );
  }

  getEndpoint(ws: WorkspaceId, id: string): Promise<EndpointRecord | null> {
    return withTenant(this.db, ws, async (tx) => {
      const [r] = await tx
        .select()
        .from(e)
        .where(and(eq(e.workspaceId, ws), eq(e.id, id)));
      return r ? toEndpoint(r) : null;
    });
  }

  insertEndpoint(r: EndpointRecord): Promise<void> {
    return withTenant(this.db, r.workspaceId, async (tx) => {
      await tx.insert(e).values(r);
    });
  }

  saveEndpoint(r: EndpointRecord, expectedVersion: number): Promise<boolean> {
    return withTenant(this.db, r.workspaceId, async (tx) => {
      const { id, workspaceId, createdAt, createdBy, ...set } = r;
      void createdAt;
      void createdBy;
      const rows = await tx
        .update(e)
        .set(set)
        .where(and(eq(e.workspaceId, workspaceId), eq(e.id, id), eq(e.version, expectedVersion)))
        .returning({ id: e.id });
      return rows.length > 0;
    });
  }

  deleteEndpoint(ws: WorkspaceId, id: string): Promise<boolean> {
    return withTenant(this.db, ws, async (tx) => {
      const rows = await tx
        .delete(e)
        .where(and(eq(e.workspaceId, ws), eq(e.id, id)))
        .returning({ id: e.id });
      return rows.length > 0;
    });
  }

  listDeliveries(
    ws: WorkspaceId,
    endpointId: string,
    q: {
      cursor?: string | undefined;
      limit: number;
      status?: DeliveryRecord['status'] | undefined;
    },
  ): Promise<{ rows: DeliveryRecord[]; nextCursor: string | null }> {
    return withTenant(this.db, ws, async (tx) => {
      const where: (SQL | undefined)[] = [eq(d.workspaceId, ws), eq(d.endpointId, endpointId)];
      if (q.status) where.push(eq(d.status, q.status));
      const after = q.cursor ? decodeCursor(q.cursor) : null;
      if (after) {
        where.push(
          sql`(${d.createdAt}, ${d.id}) < (${after.at.toISOString()}::timestamptz, ${after.id}::uuid)`,
        );
      }
      const rows = (
        await tx
          .select()
          .from(d)
          .where(and(...where))
          .orderBy(desc(d.createdAt), desc(d.id))
          .limit(q.limit + 1)
      ).map(toDelivery);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return { rows: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null };
    });
  }

  getDelivery(ws: WorkspaceId, id: string): Promise<DeliveryRecord | null> {
    return withTenant(this.db, ws, async (tx) => {
      const [r] = await tx
        .select()
        .from(d)
        .where(and(eq(d.workspaceId, ws), eq(d.id, id)));
      return r ? toDelivery(r) : null;
    });
  }

  insertDelivery(r: DeliveryRecord): Promise<void> {
    return withTenant(this.db, r.workspaceId, async (tx) => {
      await tx.insert(d).values(r);
    });
  }

  requeueDelivery(ws: WorkspaceId, id: string, at: Date): Promise<DeliveryRecord | null> {
    return withTenant(this.db, ws, async (tx) => {
      const [r] = await tx
        .update(d)
        .set({ status: 'pending', attempts: 0, nextAttemptAt: at, lastError: null })
        .where(and(eq(d.workspaceId, ws), eq(d.id, id)))
        .returning();
      return r ? toDelivery(r) : null;
    });
  }
}

/**
 * The dispatcher's outbox window and the sender's queue (app_system). The window works like the
 * HQ sync (`DrizzleSaasSystemStore`): rows of transactions that finished between the last horizon
 * and the oldest transaction still running, so a slow writer's events are never skipped.
 */
export class DrizzleDeveloperSystemStore implements DeveloperSystemStore {
  constructor(private readonly systemDb: Database) {}

  withDispatchLease<T>(fn: (lease: DispatchLease) => Promise<T>): Promise<T | null> {
    return withSystem(this.systemDb, async (tx) => {
      const got = await tx.execute<{ ok: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtext(${CONSUMER})) as ok`,
      );
      if (!got[0]?.ok) return null;
      const [row] = await tx
        .select({ horizon: cp.horizon })
        .from(cp)
        .where(eq(cp.consumer, CONSUMER));
      const from = row?.horizon ?? 0;
      const [hz] = await tx.execute<{ h: string }>(
        sql`select pg_snapshot_xmin(pg_current_snapshot())::text::bigint as h`,
      );
      const to = Number(hz?.h ?? 0);
      return fn({
        async readBatch(types, afterId, limit) {
          if (to <= from || !types.length) return [];
          const rows = await tx
            .select({
              id: o.id,
              workspaceId: o.workspaceId,
              type: o.type,
              payload: o.payload,
              createdAt: o.createdAt,
            })
            .from(o)
            .where(
              and(
                gt(o.id, afterId),
                isNotNull(o.workspaceId),
                inArray(o.type, [...types]),
                sql`${o.txId} >= ${xid(from)} and ${o.txId} < ${xid(to)}`,
              ),
            )
            .orderBy(asc(o.id))
            .limit(limit);
          return rows as PublicOutboxRow[];
        },
        async enabledEndpoints(workspaces) {
          if (!workspaces.length) return [];
          return (
            await tx
              .select()
              .from(e)
              .where(and(inArray(e.workspaceId, [...workspaces]), eq(e.enabled, true)))
          ).map(toEndpoint);
        },
        async insertDeliveries(rows) {
          if (!rows.length) return;
          await tx
            .insert(d)
            .values([...rows])
            .onConflictDoNothing({
              target: [d.endpointId, d.eventId],
            });
        },
        async commit() {
          if (to <= from) return;
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

  claimDue(now: Date, limit: number, leaseMs: number): Promise<DueDelivery[]> {
    return withSystem(this.systemDb, async (tx) => {
      const due = await tx
        .select({ id: d.id })
        .from(d)
        .innerJoin(e, and(eq(e.workspaceId, d.workspaceId), eq(e.id, d.endpointId)))
        .where(and(eq(d.status, 'pending'), lte(d.nextAttemptAt, now), eq(e.enabled, true)))
        .orderBy(asc(d.nextAttemptAt))
        .limit(limit)
        .for('update', { of: d, skipLocked: true });
      if (!due.length) return [];
      const leased = await tx
        .update(d)
        .set({ nextAttemptAt: new Date(now.getTime() + leaseMs) })
        .where(
          inArray(
            d.id,
            due.map((r) => r.id),
          ),
        )
        .returning();
      const endpoints = await tx
        .select({
          id: e.id,
          url: e.url,
          secretEncrypted: e.secretEncrypted,
          previousSecretEncrypted: e.previousSecretEncrypted,
          previousSecretExpiresAt: e.previousSecretExpiresAt,
        })
        .from(e)
        .where(inArray(e.id, [...new Set(leased.map((r) => r.endpointId))]));
      const byId = new Map(endpoints.map((x) => [x.id, x]));
      return leased.flatMap((r) => {
        const endpoint = byId.get(r.endpointId);
        return endpoint ? [{ delivery: toDelivery(r), endpoint }] : [];
      });
    });
  }

  recordAttempt(deliveryId: string, outcome: AttemptOutcome): Promise<void> {
    return withSystem(this.systemDb, async (tx) => {
      await tx.update(d).set(outcome).where(eq(d.id, deliveryId));
    });
  }

  recordEndpointHealth(endpointId: string, ok: boolean, now: Date): Promise<Date | null> {
    return withSystem(this.systemDb, async (tx) => {
      const [r] = await tx
        .update(e)
        .set({
          failingSince: ok
            ? null
            : sql`coalesce(${e.failingSince}, ${now.toISOString()}::timestamptz)`,
        })
        .where(eq(e.id, endpointId))
        .returning({ failingSince: e.failingSince });
      return r?.failingSince ?? null;
    });
  }

  disableFailing(endpointId: string, now: Date): Promise<boolean> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .update(e)
        .set({
          enabled: false,
          disabledReason: 'failing',
          version: sql`${e.version} + 1`,
          updatedAt: now,
        })
        .where(and(eq(e.id, endpointId), eq(e.enabled, true)))
        .returning({ id: e.id });
      return rows.length > 0;
    });
  }
}
