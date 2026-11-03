import { SaasBillingPeriod, SaasChurnReason, SaasStage } from '@agent-sales/contracts';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  schema,
  sql,
  withTenant,
  writeAudit,
  writeOutbox,
  type Database,
} from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
  HistoryRecord,
  HqLinkRecord,
  PlanRecord,
  SaasStore,
  SaasTx,
  SubscriptionRecord,
} from '../../application/ports/saas-store.js';
import { SaasError } from '../../domain/saas.errors.js';

const s = schema.saasSubscriptions;
const p = schema.saasPlans;
const h = schema.saasSubscriptionHistory;
const l = schema.saasHqLinks;

type PgError = { code?: string; constraint_name?: string };
const pgError = (e: unknown): PgError => (e as { cause?: PgError }).cause ?? (e as PgError);
/** A unique key broken by a subscription write is a conflict, not a server error. */
async function conflictOnDuplicate(write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (e) {
    const pg = pgError(e);
    if (pg.code === '23505')
      throw new SaasError(
        'CONFLICT',
        pg.constraint_name === 'saas_subscriptions_external_ref_unique'
          ? 'This external reference is already used'
          : pg.constraint_name === 'saas_plans_name_active'
            ? 'A plan with this name already exists'
            : 'This customer already has a subscription',
      );
    throw e;
  }
}

function toSubscription(row: typeof s.$inferSelect): SubscriptionRecord {
  return {
    id: row.id,
    contactId: row.contactId,
    planName: row.planName,
    stage: SaasStage.parse(row.stage),
    billingPeriod: SaasBillingPeriod.parse(row.billingPeriod),
    mrr: row.mrr,
    planId: row.planId,
    seats: row.seats,
    trialEndsOn: row.trialEndsOn,
    startedOn: row.startedOn,
    renewsOn: row.renewsOn,
    canceledOn: row.canceledOn,
    externalRef: row.externalRef,
    note: row.note,
    churnReason: row.churnReason ? SaasChurnReason.parse(row.churnReason) : null,
    churnNote: row.churnNote,
    externalSource: row.externalSource ?? null,
    usage:
      row.usageUsed !== null && row.usageLimit !== null && row.usageAt
        ? { used: row.usageUsed, limit: row.usageLimit, at: row.usageAt.toISOString() }
        : null,
    remindersSent: row.remindersSent,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
const toPlan = (row: typeof p.$inferSelect): PlanRecord => ({
  id: row.id,
  name: row.name,
  prices: row.prices,
  position: row.position,
  archivedAt: row.archivedAt?.toISOString() ?? null,
  version: row.version,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
const toHistory = (row: typeof h.$inferSelect): HistoryRecord => ({
  id: row.id,
  subscriptionId: row.subscriptionId,
  contactId: row.contactId,
  fromStage: row.fromStage ? SaasStage.parse(row.fromStage) : null,
  toStage: SaasStage.parse(row.toStage),
  fromPlan: row.fromPlan,
  toPlan: row.toPlan,
  fromMrr: row.fromMrr,
  toMrr: row.toMrr,
  churnReason: row.churnReason ? SaasChurnReason.parse(row.churnReason) : null,
  source: row.source,
  actorUserId: row.actorUserId,
  changedAt: row.changedAt.toISOString(),
});
const toLink = (row: typeof l.$inferSelect): HqLinkRecord => ({
  accountId: row.accountId,
  contactId: row.contactId,
  applied: row.applied,
});
const subscriptionValues = (x: SubscriptionRecord) => ({
  planName: x.planName,
  stage: x.stage,
  billingPeriod: x.billingPeriod,
  mrr: x.mrr,
  planId: x.planId,
  seats: x.seats,
  trialEndsOn: x.trialEndsOn,
  startedOn: x.startedOn,
  renewsOn: x.renewsOn,
  canceledOn: x.canceledOn,
  externalRef: x.externalRef,
  note: x.note,
  churnReason: x.churnReason,
  churnNote: x.churnNote,
  externalSource: x.externalSource,
  usageUsed: x.usage?.used ?? null,
  usageLimit: x.usage?.limit ?? null,
  usageAt: x.usage ? new Date(x.usage.at) : null,
  remindersSent: x.remindersSent,
  version: x.version,
  updatedAt: new Date(x.updatedAt),
});

export class DrizzleSaasStore implements SaasStore {
  constructor(private readonly db: Database) {}

  run<T>(ws: WorkspaceId, fn: (tx: SaasTx) => Promise<T>): Promise<T> {
    return withTenant(this.db, ws, async (tx) => {
      const port: SaasTx = {
        async lockKey(key) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`saas:${ws}:${key}`}, 0))`,
          );
        },
        async findSubscription(contactId, lock) {
          const q = tx
            .select()
            .from(s)
            .where(and(eq(s.workspaceId, ws), eq(s.contactId, contactId)))
            .limit(1);
          const [row] = await (lock ? q.for('update') : q);
          return row ? toSubscription(row) : null;
        },
        async findSubscriptionByExternalRef(ref, lock) {
          const q = tx
            .select()
            .from(s)
            .where(and(eq(s.workspaceId, ws), eq(s.externalRef, ref)))
            .limit(1);
          const [row] = await (lock ? q.for('update') : q);
          return row ? toSubscription(row) : null;
        },
        async listSubscriptions(f) {
          const rows = await tx
            .select()
            .from(s)
            .where(
              and(
                eq(s.workspaceId, ws),
                f.stage ? eq(s.stage, f.stage) : undefined,
                f.contactIds ? inArray(s.contactId, f.contactIds) : undefined,
                f.trialEnds
                  ? and(
                      eq(s.stage, 'trial'),
                      gte(s.trialEndsOn, f.trialEnds.from),
                      lt(s.trialEndsOn, f.trialEnds.before),
                    )
                  : undefined,
              ),
            )
            .orderBy(...(f.trialEnds ? [asc(s.trialEndsOn)] : []), desc(s.updatedAt), desc(s.id))
            .limit(101)
            .offset(f.offset);
          return rows.map(toSubscription);
        },
        async insertSubscription(x) {
          await conflictOnDuplicate(() =>
            tx.insert(s).values({
              ...subscriptionValues(x),
              id: x.id,
              workspaceId: ws,
              contactId: x.contactId,
              createdAt: new Date(x.createdAt),
            }),
          );
        },
        async updateSubscription(x) {
          await conflictOnDuplicate(() =>
            tx
              .update(s)
              .set(subscriptionValues(x))
              .where(and(eq(s.workspaceId, ws), eq(s.id, x.id))),
          );
        },
        async summary(today, soon) {
          const [sub] = await tx
            .select({
              mrr: sql<string>`coalesce(sum(${s.mrr}) filter (where ${s.stage} in ('active','past_due')), 0)`,
              trial: sql<number>`count(*) filter (where ${s.stage} = 'trial')::int`,
              free: sql<number>`count(*) filter (where ${s.stage} = 'free')::int`,
              active: sql<number>`count(*) filter (where ${s.stage} = 'active')::int`,
              pastDue: sql<number>`count(*) filter (where ${s.stage} = 'past_due')::int`,
              canceled: sql<number>`count(*) filter (where ${s.stage} = 'canceled')::int`,
              soon: sql<number>`count(*) filter (where ${s.stage} = 'trial' and ${s.trialEndsOn} >= ${today}::date and ${s.trialEndsOn} < ${soon}::date)::int`,
            })
            .from(s)
            .where(eq(s.workspaceId, ws));
          return {
            mrr: Number(sub?.mrr ?? 0),
            stages: {
              trial: sub?.trial ?? 0,
              free: sub?.free ?? 0,
              active: sub?.active ?? 0,
              past_due: sub?.pastDue ?? 0,
              canceled: sub?.canceled ?? 0,
            },
            trialsEndingSoon: sub?.soon ?? 0,
          };
        },
        async listPlans(withArchived) {
          const rows = await tx
            .select()
            .from(p)
            .where(and(eq(p.workspaceId, ws), withArchived ? undefined : isNull(p.archivedAt)))
            .orderBy(asc(p.position), asc(p.name), asc(p.id));
          return rows.map(toPlan);
        },
        async findPlan(id, lock) {
          const q = tx
            .select()
            .from(p)
            .where(and(eq(p.workspaceId, ws), eq(p.id, id)))
            .limit(1);
          const [row] = await (lock ? q.for('update') : q);
          return row ? toPlan(row) : null;
        },
        async insertPlan(x) {
          await conflictOnDuplicate(() =>
            tx.insert(p).values({
              id: x.id,
              workspaceId: ws,
              name: x.name,
              prices: x.prices,
              position: x.position,
              archivedAt: x.archivedAt ? new Date(x.archivedAt) : null,
              version: x.version,
              createdAt: new Date(x.createdAt),
              updatedAt: new Date(x.updatedAt),
            }),
          );
        },
        async updatePlan(x) {
          await conflictOnDuplicate(() =>
            tx
              .update(p)
              .set({
                name: x.name,
                prices: x.prices,
                position: x.position,
                archivedAt: x.archivedAt ? new Date(x.archivedAt) : null,
                version: x.version,
                updatedAt: new Date(x.updatedAt),
              })
              .where(and(eq(p.workspaceId, ws), eq(p.id, x.id))),
          );
        },
        async insertHistory(x) {
          await tx.insert(h).values({ ...x, workspaceId: ws, changedAt: new Date(x.changedAt) });
        },
        async listHistory(subscriptionId) {
          const rows = await tx
            .select()
            .from(h)
            .where(and(eq(h.workspaceId, ws), eq(h.subscriptionId, subscriptionId)))
            .orderBy(desc(h.changedAt), desc(h.id))
            .limit(200);
          return rows.map(toHistory);
        },
        async findHqLink(accountId, lock) {
          const q = tx
            .select()
            .from(l)
            .where(and(eq(l.workspaceId, ws), eq(l.accountId, accountId)))
            .limit(1);
          const [row] = await (lock ? q.for('update') : q);
          return row ? toLink(row) : null;
        },
        async saveHqLink(x) {
          await tx
            .insert(l)
            .values({
              workspaceId: ws,
              accountId: x.accountId,
              contactId: x.contactId,
              applied: x.applied,
            })
            .onConflictDoUpdate({
              target: [l.workspaceId, l.accountId],
              set: { contactId: x.contactId, applied: x.applied, updatedAt: new Date() },
            });
        },
        async listHqLinks() {
          const rows = await tx.select().from(l).where(eq(l.workspaceId, ws));
          return rows.map(toLink);
        },
        async audit(actor, action, target, data) {
          await writeAudit(tx, {
            workspaceId: ws,
            actorUserId: actor.userId,
            actorName: actor.name,
            action,
            targetType: target.type,
            targetId: target.id,
            data,
          });
        },
        async outbox(type, aggregateId, payload) {
          await writeOutbox(tx, {
            workspaceId: ws,
            type,
            aggregateType: 'saas_subscription',
            aggregateId,
            payload,
          });
        },
      };
      return fn(port);
    });
  }
}
