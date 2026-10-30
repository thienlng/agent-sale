import { SaasStage, SaasBillingPeriod } from '@agent-sales/contracts';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lt,
  schema,
  sql,
  withTenant,
  writeAudit,
  type Database,
} from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type { SaasStore, SaasTx, SubscriptionRecord } from '../../application/ports/saas-store.js';
import { SaasError } from '../../domain/saas.errors.js';

const s = schema.saasSubscriptions;

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
    seats: row.seats,
    trialEndsOn: row.trialEndsOn,
    startedOn: row.startedOn,
    renewsOn: row.renewsOn,
    canceledOn: row.canceledOn,
    externalRef: row.externalRef,
    note: row.note,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
const subscriptionValues = (x: SubscriptionRecord) => ({
  planName: x.planName,
  stage: x.stage,
  billingPeriod: x.billingPeriod,
  mrr: x.mrr,
  seats: x.seats,
  trialEndsOn: x.trialEndsOn,
  startedOn: x.startedOn,
  renewsOn: x.renewsOn,
  canceledOn: x.canceledOn,
  externalRef: x.externalRef,
  note: x.note,
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
              active: sub?.active ?? 0,
              past_due: sub?.pastDue ?? 0,
              canceled: sub?.canceled ?? 0,
            },
            trialsEndingSoon: sub?.soon ?? 0,
          };
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
      };
      return fn(port);
    });
  }
}
