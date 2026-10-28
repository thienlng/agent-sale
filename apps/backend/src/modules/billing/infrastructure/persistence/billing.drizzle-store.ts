import {
  and,
  type Database,
  eq,
  gt,
  or,
  schema,
  sql,
  withSystem,
  withTenant,
} from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type { BillingState, BillingStore } from '../../application/ports/billing-store.js';
import type { PlanRecord, SubscriptionRecord } from '../../domain/entitlements.js';
import { RESERVATION_TTL_MS, type ReserveResult } from '../../domain/usage.js';

type SubscriptionRow = {
  planCode: string;
  planVersion: number;
  status: string;
  currentPeriodEnd: Date | null;
};

const toSubscription = (row: SubscriptionRow, cycleAnchor: Date): SubscriptionRecord => ({
  planCode: row.planCode,
  planVersion: row.planVersion,
  status: row.status as SubscriptionRecord['status'],
  currentPeriodEnd: row.currentPeriodEnd,
  cycleAnchor,
});

const u = schema.messageUsage;

/** Rows that hold allowance: delivered replies and reservations younger than the TTL. */
const holding = (fresh: Date) =>
  or(eq(u.status, 'captured'), and(eq(u.status, 'reserved'), gt(u.reservedAt, fresh)));

/**
 * Workspace state under tenant RLS. The plan catalog, account subscriptions and the message
 * meter are platform data (migration 0031), so they use the system role.
 */
export class DrizzleBillingStore implements BillingStore {
  constructor(
    private readonly tenantDb: Database,
    private readonly systemDb: Database,
  ) {}

  async state(ws: WorkspaceId, accountId: string | null): Promise<BillingState> {
    const business = await withTenant(this.tenantDb, ws, async (tx) => {
      const [sub] = await tx.select().from(schema.subscriptions).limit(1);
      const overrides = await tx.select().from(schema.workspaceEntitlementOverrides);
      return {
        subscription: sub ? toSubscription(sub, sub.currentPeriodStart) : null,
        overrides: overrides.map((o) => ({ key: o.key, value: o.value, expiresAt: o.expiresAt })),
      };
    });
    if (!accountId) return { ...business, accountSubscription: null, accountOverrides: [] };
    return withSystem(this.systemDb, async (tx) => {
      const [sub] = await tx
        .select()
        .from(schema.accountSubscriptions)
        .where(eq(schema.accountSubscriptions.accountId, accountId))
        .limit(1);
      const overrides = await tx
        .select()
        .from(schema.accountEntitlementOverrides)
        .where(eq(schema.accountEntitlementOverrides.accountId, accountId));
      return {
        ...business,
        accountSubscription: sub ? toSubscription(sub, sub.cycleAnchor) : null,
        accountOverrides: overrides.map((o) => ({
          key: o.key,
          value: o.value,
          expiresAt: o.expiresAt,
        })),
      };
    });
  }

  plan(code: string, version: number): Promise<PlanRecord | null> {
    return withSystem(this.systemDb, async (tx) => {
      const [p] = await tx
        .select()
        .from(schema.plans)
        .where(and(eq(schema.plans.code, code), eq(schema.plans.version, version)))
        .limit(1);
      return p
        ? { code: p.code, version: p.version, name: p.name, entitlements: p.entitlements }
        : null;
    });
  }

  reserve(input: Parameters<BillingStore['reserve']>[0]): Promise<ReserveResult> {
    const { accountId, workspaceId: ws, key, cycleStart, now } = input;
    const fresh = new Date(now.getTime() - RESERVATION_TTL_MS);
    return withSystem(this.systemDb, async (tx) => {
      // Every reply of the account goes through this lock: concurrent replies of its businesses
      // cannot both take the last unit of the allowance.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${accountId}::text, 12))`);
      const [row] = await tx
        .select({ status: u.status, cycleStart: u.cycleStart, reservedAt: u.reservedAt })
        .from(u)
        .where(and(eq(u.workspaceId, ws), eq(u.idempotencyKey, key)))
        .limit(1);
      if (row?.status === 'captured') return 'already_captured';
      const heldNow =
        row?.status === 'reserved' &&
        row.cycleStart.getTime() === cycleStart.getTime() &&
        row.reservedAt.getTime() > fresh.getTime();
      if (!heldNow) {
        const [counted] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(u)
          .where(
            and(
              eq(u.accountId, accountId),
              eq(u.cycleStart, cycleStart),
              holding(fresh),
              sql`not (${u.workspaceId} = ${ws} and ${u.idempotencyKey} = ${key})`,
            ),
          );
        if ((counted?.n ?? 0) >= input.limit) return 'exhausted';
      }
      await tx
        .insert(u)
        .values({
          accountId,
          workspaceId: ws,
          idempotencyKey: key,
          cycleStart,
          status: 'reserved',
          conversationId: input.conversationId,
          botId: input.botId,
          reservedAt: now,
        })
        .onConflictDoUpdate({
          target: [u.workspaceId, u.idempotencyKey],
          set: { accountId, cycleStart, status: 'reserved', reservedAt: now, releasedAt: null },
        });
      return 'reserved';
    });
  }

  async capture(ws: WorkspaceId, key: string, now: Date): Promise<void> {
    await withSystem(this.systemDb, (tx) =>
      tx
        .update(u)
        .set({ status: 'captured', capturedAt: now })
        .where(
          and(eq(u.workspaceId, ws), eq(u.idempotencyKey, key), sql`${u.status} <> 'captured'`),
        ),
    );
  }

  async release(ws: WorkspaceId, key: string, now: Date): Promise<void> {
    await withSystem(this.systemDb, (tx) =>
      tx
        .update(u)
        .set({ status: 'released', releasedAt: now })
        .where(and(eq(u.workspaceId, ws), eq(u.idempotencyKey, key), eq(u.status, 'reserved'))),
    );
  }

  used(accountId: string, cycleStart: Date, now: Date): Promise<number> {
    const fresh = new Date(now.getTime() - RESERVATION_TTL_MS);
    return withSystem(this.systemDb, async (tx) => {
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(u)
        .where(and(eq(u.accountId, accountId), eq(u.cycleStart, cycleStart), holding(fresh)));
      return row?.n ?? 0;
    });
  }
}
