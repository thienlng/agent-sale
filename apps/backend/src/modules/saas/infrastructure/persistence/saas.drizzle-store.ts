import {
  SaasRequestKind,
  SaasRequestSource,
  SaasRequestStatus,
  SaasStage,
  SaasBillingPeriod,
} from '@agent-sales/contracts';
import { and, desc, eq, schema, sql, withTenant, writeAudit, type Database } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
  SaasStore,
  SaasTx,
  StoredRequest,
  SubscriptionRecord,
} from '../../application/ports/saas-store.js';
import { SaasError } from '../../domain/saas.errors.js';

const r = schema.saasRequests,
  s = schema.saasSubscriptions;

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

function toRequest(row: typeof r.$inferSelect): StoredRequest {
  return {
    id: row.id,
    clientRequestId: row.clientRequestId,
    fingerprint: row.fingerprint,
    kind: SaasRequestKind.parse(row.kind),
    status: SaasRequestStatus.parse(row.status),
    source: SaasRequestSource.parse(row.source),
    name: row.name,
    phone: row.phone,
    email: row.email,
    company: row.company,
    teamSize: row.teamSize,
    need: row.need,
    preferredTime: row.preferredTime,
    planInterest: row.planInterest,
    contactId: row.contactId,
    conversationId: row.conversationId,
    note: row.note,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
const requestValues = (x: StoredRequest) => ({
  kind: x.kind,
  status: x.status,
  name: x.name,
  phone: x.phone,
  email: x.email,
  company: x.company,
  teamSize: x.teamSize,
  need: x.need,
  preferredTime: x.preferredTime,
  planInterest: x.planInterest,
  contactId: x.contactId,
  note: x.note,
  fingerprint: x.fingerprint,
  version: x.version,
  updatedAt: new Date(x.updatedAt),
});

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
        async findRequest(id, lock) {
          const q = tx
            .select()
            .from(r)
            .where(and(eq(r.workspaceId, ws), eq(r.id, id)))
            .limit(1);
          const [row] = await (lock ? q.for('update') : q);
          return row ? toRequest(row) : null;
        },
        async findRequestByKey(key, lock) {
          const q = tx
            .select()
            .from(r)
            .where(and(eq(r.workspaceId, ws), eq(r.clientRequestId, key)))
            .limit(1);
          const [row] = await (lock ? q.for('update') : q);
          return row ? toRequest(row) : null;
        },
        async listRequests(f) {
          const rows = await tx
            .select()
            .from(r)
            .where(
              and(
                eq(r.workspaceId, ws),
                f.status ? eq(r.status, f.status) : undefined,
                f.kind ? eq(r.kind, f.kind) : undefined,
              ),
            )
            .orderBy(desc(r.createdAt), desc(r.id))
            .limit(101)
            .offset(f.offset);
          return rows.map(toRequest);
        },
        async insertRequest(x) {
          await tx.insert(r).values({
            ...requestValues(x),
            id: x.id,
            workspaceId: ws,
            clientRequestId: x.clientRequestId,
            source: x.source,
            conversationId: x.conversationId,
            createdAt: new Date(x.createdAt),
          });
        },
        async updateRequest(x) {
          await tx
            .update(r)
            .set(requestValues(x))
            .where(and(eq(r.workspaceId, ws), eq(r.id, x.id)));
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
            .where(and(eq(s.workspaceId, ws), f.stage ? eq(s.stage, f.stage) : undefined))
            .orderBy(desc(s.updatedAt), desc(s.id))
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
          const [req] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(r)
            .where(and(eq(r.workspaceId, ws), eq(r.status, 'new')));
          return {
            mrr: Number(sub?.mrr ?? 0),
            stages: {
              trial: sub?.trial ?? 0,
              active: sub?.active ?? 0,
              past_due: sub?.pastDue ?? 0,
              canceled: sub?.canceled ?? 0,
            },
            trialsEndingSoon: sub?.soon ?? 0,
            newRequests: req?.n ?? 0,
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
