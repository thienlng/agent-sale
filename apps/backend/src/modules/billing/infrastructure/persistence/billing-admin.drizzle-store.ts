import {
  and,
  asc,
  type Database,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  or,
  schema,
  sql,
  type TenantTx,
  withSystem,
  writeAudit,
  writePlatformAudit,
  writeSystemOutbox,
} from '@agent-sales/db';
import { newId, workspaceId } from '@agent-sales/shared';

import type {
  AccountMatch,
  AccountSubscriptionFilter,
  AccountSubscriptionRow,
  AdminOverrideRecord,
  BillingAdminStore,
  BillingSettings,
  BillingSettingsInput,
  NewPayment,
  OperatorAction,
  PaymentRecord,
  SubscriptionChangeInput,
} from '../../application/ports/billing-admin-store.js';
import {
  BillingAccountNotFoundError,
  BillingStateError,
  BillingVersionConflictError,
  PaymentNotFoundError,
  PlanUnknownError,
} from '../../domain/billing.errors.js';
import type { OverrideRecord } from '../../domain/entitlements.js';
import { addDays, type CatalogPlan, mrrVnd, type PlanBody } from '../../domain/plan-catalog.js';

const p = schema.plans;
const s = schema.accountSubscriptions;
const st = schema.billingSettings;
const pay = schema.payments;
/** Cursors carry a JS Date (ms): order and compare at ms so no row falls between two pages. */
const payAt = sql`date_trunc('milliseconds', ${pay.createdAt})`;
const o = schema.accountEntitlementOverrides;

/** The account subscriptions a list filter may return at most (admin screens page the accounts). */
const MATCH_MAX = 5000;

type PlanRow = typeof p.$inferSelect;
type SubRow = typeof s.$inferSelect;

const toPlan = (r: PlanRow): CatalogPlan => ({
  code: r.code,
  version: r.version,
  name: r.name,
  description: r.description,
  isPublic: r.isPublic,
  sortOrder: r.sortOrder,
  archivedAt: r.archivedAt,
  priceByPeriod: r.priceByPeriod,
  entitlements: r.entitlements,
  createdAt: r.createdAt,
});

const toSub = (r: SubRow): AccountSubscriptionRow => ({
  accountId: r.accountId,
  planCode: r.planCode,
  planVersion: r.planVersion,
  status: r.status,
  periodMonths: r.periodMonths,
  currentPeriodStart: r.currentPeriodStart,
  currentPeriodEnd: r.currentPeriodEnd,
  cycleAnchor: r.cycleAnchor,
  statusChangedAt: r.statusChangedAt,
  remindersSent: r.remindersSent,
  version: r.version,
});

const toSettings = (r: typeof st.$inferSelect): BillingSettings => ({
  trialEnabled: r.trialEnabled,
  trialPlanCode: r.trialPlanCode,
  trialDays: r.trialDays,
  afterTrialPlanCode: r.afterTrialPlanCode,
  hqContactScope: r.hqContactScope,
  graceDays: r.graceDays,
  suspendDays: r.suspendDays,
  bankBin: r.bankBin,
  bankAccountNo: r.bankAccountNo,
  bankAccountName: r.bankAccountName,
  version: r.version,
  updatedAt: r.updatedAt,
});

const paymentColumns = {
  id: pay.id,
  accountId: pay.accountId,
  accountName: schema.accounts.name,
  code: pay.code,
  planCode: pay.planCode,
  planVersion: pay.planVersion,
  planName: p.name,
  periodMonths: pay.periodMonths,
  amountVnd: pay.amountVnd,
  status: pay.status,
  bankReference: pay.bankReference,
  note: pay.note,
  confirmedAt: pay.confirmedAt,
  createdAt: pay.createdAt,
};

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** A row the statement must have returned (insert … returning, a row locked just before). */
function must<T>(row: T | null | undefined): T {
  if (row === undefined || row === null) throw new Error('Expected a row');
  return row;
}

/** Platform billing administration with the system role (ADR-021 §6). */
export class DrizzleBillingAdminStore implements BillingAdminStore {
  constructor(private readonly db: Database) {}

  listPlans() {
    return withSystem(this.db, async (tx) => {
      const rows = await tx
        .select()
        .from(p)
        .orderBy(asc(p.sortOrder), asc(p.code), desc(p.version));
      const counts = await tx
        .select({ code: s.planCode, version: s.planVersion, n: sql<number>`count(*)::int` })
        .from(s)
        .groupBy(s.planCode, s.planVersion);
      const count = new Map(counts.map((c) => [`${c.code}@${c.version}`, c.n]));
      const latest = new Set<string>();
      return rows
        .filter((r) => {
          const isLatest = !latest.has(r.code);
          latest.add(r.code);
          return isLatest || (count.get(`${r.code}@${r.version}`) ?? 0) > 0;
        })
        .map((r) => ({ ...toPlan(r), subscriberCount: count.get(`${r.code}@${r.version}`) ?? 0 }));
    });
  }

  latestPlan(code: string) {
    return withSystem(this.db, (tx) => latestPlan(tx, code));
  }

  createPlan(code: string, body: PlanBody, action: OperatorAction) {
    return withSystem(this.db, async (tx) => {
      // Serializes creations and publications of one code.
      await lockKey(tx, `plan:${code}`);
      if (await latestPlan(tx, code)) {
        throw new BillingStateError('A plan with this code already exists', { code });
      }
      const [row] = await tx
        .insert(p)
        .values({ code, version: 1, ...body, createdBy: action.actorUserId })
        .returning();
      await audit(tx, action, 'billing.plan.created', 'plan', code, { version: 1, ...body });
      return toPlan(must(row));
    });
  }

  publishPlanVersion(
    code: string,
    body: PlanBody,
    expectedVersion: number,
    action: OperatorAction,
  ) {
    return withSystem(this.db, async (tx) => {
      await lockKey(tx, `plan:${code}`);
      const current = await latestPlan(tx, code);
      if (!current) throw new PlanUnknownError(code);
      if (current.version !== expectedVersion) throw new BillingVersionConflictError('plan');
      const version = current.version + 1;
      const [row] = await tx
        .insert(p)
        .values({
          code,
          version,
          ...body,
          archivedAt: current.archivedAt,
          createdBy: action.actorUserId,
        })
        .returning();
      await audit(tx, action, 'billing.plan.published', 'plan', code, { version, ...body });
      return toPlan(must(row));
    });
  }

  archivePlan(
    code: string,
    archived: boolean,
    guard: (settings: BillingSettings) => void,
    action: OperatorAction,
  ) {
    return withSystem(this.db, async (tx) => {
      await lockKey(tx, `plan:${code}`);
      if (!(await latestPlan(tx, code))) throw new PlanUnknownError(code);
      // The settings row is locked so a concurrent settings change cannot point at this plan.
      const [settings] = await tx.select().from(st).where(eq(st.id, 'default')).for('update');
      if (archived) guard(toSettings(must(settings)));
      await tx
        .update(p)
        .set({ archivedAt: archived ? new Date() : null })
        .where(eq(p.code, code));
      await audit(
        tx,
        action,
        archived ? 'billing.plan.archived' : 'billing.plan.restored',
        'plan',
        code,
      );
      return must(await latestPlan(tx, code));
    });
  }

  settings() {
    return withSystem(this.db, async (tx) => {
      const [row] = await tx.select().from(st).where(eq(st.id, 'default'));
      return toSettings(must(row));
    });
  }

  putSettings(next: BillingSettingsInput, expectedVersion: number, action: OperatorAction) {
    return withSystem(this.db, async (tx) => {
      for (const code of [next.trialPlanCode, next.afterTrialPlanCode]) {
        if (code === null) continue;
        const plan = await latestPlan(tx, code);
        if (!plan) throw new PlanUnknownError(code);
        if (plan.archivedAt) throw new BillingStateError('The plan is archived', { code });
      }
      const [row] = await tx
        .update(st)
        .set({
          ...next,
          version: sql`${st.version} + 1`,
          updatedBy: action.actorUserId,
          updatedAt: new Date(),
        })
        .where(and(eq(st.id, 'default'), eq(st.version, expectedVersion)))
        .returning();
      if (!row) throw new BillingVersionConflictError('billing settings');
      await audit(tx, action, 'billing.settings.updated', 'billing_settings', 'default', {
        ...next,
        version: row.version,
      });
      return toSettings(row);
    });
  }

  subscriptions(accountIds: readonly string[]) {
    if (!accountIds.length) return Promise.resolve([]);
    return withSystem(this.db, async (tx) =>
      (
        await tx
          .select()
          .from(s)
          .where(inArray(s.accountId, [...accountIds]))
      ).map(toSub),
    );
  }

  matchAccounts(filter: AccountSubscriptionFilter, now: Date): Promise<AccountMatch> {
    return withSystem(this.db, async (tx) => {
      // The free plan has no row for most accounts: match it as "every account not on a paid row".
      if (filter.planCode === 'free' && !filter.subscriptionStatus && !filter.endingWithinDays) {
        const rows = await tx
          .select({ id: s.accountId })
          .from(s)
          .where(sql`${s.planCode} <> 'free'`)
          .limit(MATCH_MAX);
        return { ids: rows.map((r) => r.id), exclude: true };
      }
      const where = [
        filter.subscriptionStatus ? eq(s.status, filter.subscriptionStatus) : undefined,
        filter.planCode ? eq(s.planCode, filter.planCode) : undefined,
        filter.endingWithinDays
          ? and(
              isNotNull(s.currentPeriodEnd),
              gte(s.currentPeriodEnd, now),
              lte(s.currentPeriodEnd, addDays(now, filter.endingWithinDays)),
            )
          : undefined,
      ];
      const rows = await tx
        .select({ id: s.accountId })
        .from(s)
        .where(and(...where))
        .limit(MATCH_MAX);
      return { ids: rows.map((r) => r.id), exclude: false };
    });
  }

  changeSubscription(input: SubscriptionChangeInput) {
    return withSystem(this.db, (tx) => changeSubscription(tx, input));
  }

  overrides(accountId: string) {
    return withSystem(this.db, async (tx) =>
      (await tx.select().from(o).where(eq(o.accountId, accountId)).orderBy(asc(o.key))).map(
        (r): AdminOverrideRecord => ({
          key: r.key,
          value: r.value,
          expiresAt: r.expiresAt,
          reason: r.reason,
          createdAt: r.createdAt,
        }),
      ),
    );
  }

  putOverride(accountId: string, override: OverrideRecord, action: OperatorAction) {
    return withSystem(this.db, async (tx) => {
      await assertAccount(tx, accountId);
      const values = {
        value: override.value,
        expiresAt: override.expiresAt,
        reason: action.reason,
        createdAt: new Date(),
      };
      const [row] = await tx
        .insert(o)
        .values({ accountId, key: override.key, ...values })
        .onConflictDoUpdate({ target: [o.accountId, o.key], set: values })
        .returning();
      await audit(tx, action, 'billing.override.set', 'account', accountId, {
        key: override.key,
        value: override.value,
        expiresAt: iso(override.expiresAt),
      });
      const saved = must(row);
      return {
        key: saved.key,
        value: saved.value,
        expiresAt: saved.expiresAt,
        reason: saved.reason,
        createdAt: saved.createdAt,
      };
    });
  }

  deleteOverride(accountId: string, key: string, action: OperatorAction) {
    return withSystem(this.db, async (tx) => {
      const deleted = await tx
        .delete(o)
        .where(and(eq(o.accountId, accountId), eq(o.key, key)))
        .returning({ key: o.key });
      if (!deleted.length) return false;
      await audit(tx, action, 'billing.override.removed', 'account', accountId, { key });
      return true;
    });
  }

  listPayments(query: Parameters<BillingAdminStore['listPayments']>[0]) {
    return withSystem(this.db, async (tx) => {
      const c = query.cursor;
      return (await paymentQuery(tx)
        .where(
          and(
            query.status ? eq(pay.status, query.status) : undefined,
            query.accountId ? eq(pay.accountId, query.accountId) : undefined,
            c
              ? sql`(${payAt}, ${pay.id}) < (${c.createdAt.toISOString()}::timestamptz, ${c.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(sql`${payAt} desc`, desc(pay.id))
        .limit(query.limit)) as PaymentRecord[];
    });
  }

  payment(id: string) {
    return withSystem(this.db, (tx) => paymentById(tx, id));
  }

  createPayment(input: NewPayment, action: OperatorAction) {
    return withSystem(this.db, async (tx) => {
      await assertAccount(tx, input.accountId);
      const id = newId();
      await tx.insert(pay).values({ id, ...input, requestedBy: action.actorUserId });
      await audit(tx, action, 'billing.payment.created', 'payment', id, {
        accountId: input.accountId,
        code: input.code,
        plan: input.planCode,
        planVersion: input.planVersion,
        periodMonths: input.periodMonths,
        amountVnd: input.amountVnd,
      });
      return must(await paymentById(tx, id));
    });
  }

  confirmPayment(
    id: string,
    bankReference: string | null,
    change: Parameters<BillingAdminStore['confirmPayment']>[2],
    action: OperatorAction,
  ) {
    return withSystem(this.db, async (tx) => {
      const payment = await pendingPayment(tx, id);
      const now = new Date();
      await tx
        .update(pay)
        .set({
          status: 'confirmed',
          confirmedBy: action.actorUserId,
          confirmedAt: now,
          bankReference,
          updatedAt: now,
        })
        .where(eq(pay.id, id));
      await audit(tx, action, 'billing.payment.confirmed', 'payment', id, {
        accountId: payment.accountId,
        code: payment.code,
        amountVnd: payment.amountVnd,
        bankReference,
      });
      await changeSubscription(tx, { ...change(payment), accountId: payment.accountId, action });
      return must(await paymentById(tx, id));
    });
  }

  cancelPayment(id: string, action: OperatorAction) {
    return withSystem(this.db, async (tx) => {
      const payment = await pendingPayment(tx, id);
      await tx.update(pay).set({ status: 'canceled', updatedAt: new Date() }).where(eq(pay.id, id));
      await audit(tx, action, 'billing.payment.canceled', 'payment', id, {
        accountId: payment.accountId,
        code: payment.code,
      });
      return must(await paymentById(tx, id));
    });
  }

  lifecycleCandidates(now: Date, horizonDays: number, limit: number) {
    const horizon = addDays(now, horizonDays);
    return withSystem(this.db, async (tx) =>
      (
        await tx
          .select()
          .from(s)
          .where(
            or(
              and(
                inArray(s.status, ['trialing', 'active']),
                isNotNull(s.currentPeriodEnd),
                lte(s.currentPeriodEnd, horizon),
              ),
              inArray(s.status, ['past_due', 'suspended']),
            ),
          )
          .orderBy(asc(s.currentPeriodEnd))
          .limit(limit)
      ).map(toSub),
    );
  }

  sendReminder(accountId: string, keys: readonly string[], payload: Record<string, unknown>) {
    return withSystem(this.db, async (tx) => {
      const [row] = await tx.select().from(s).where(eq(s.accountId, accountId)).for('update');
      if (!row || keys.every((k) => k in row.remindersSent)) return false;
      const at = new Date().toISOString();
      const sent = { ...row.remindersSent };
      for (const k of keys) sent[k] ??= at;
      await tx.update(s).set({ remindersSent: sent }).where(eq(s.accountId, accountId));
      await writeSystemOutbox(tx, {
        type: 'billing.subscription.reminder.v1',
        aggregateType: 'account',
        aggregateId: accountId,
        payload,
      });
      return true;
    });
  }

  activeAccountIds(afterId: string | null, limit: number) {
    const a = schema.accounts;
    return withSystem(this.db, async (tx) =>
      (
        await tx
          .select({ id: a.id })
          .from(a)
          .where(and(eq(a.status, 'active'), afterId ? sql`${a.id} > ${afterId}` : undefined))
          .orderBy(asc(a.id))
          .limit(limit)
      ).map((r) => r.id),
    );
  }

  snapshotWritten(since: Date) {
    return withSystem(this.db, (tx) => snapshotWritten(tx, since));
  }

  writeUsageSnapshots(since: Date, payloads: readonly Record<string, unknown>[]) {
    return withSystem(this.db, async (tx) => {
      await lockKey(tx, 'billing:usage-snapshot');
      if (await snapshotWritten(tx, since)) return false;
      for (const payload of payloads) {
        await writeSystemOutbox(tx, {
          type: 'billing.usage.snapshot.v1',
          aggregateType: 'account',
          aggregateId: String(payload['accountId']),
          payload,
        });
      }
      return true;
    });
  }
}

async function lockKey(tx: TenantTx, key: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}::text, 21))`);
}

async function latestPlan(tx: TenantTx, code: string): Promise<CatalogPlan | null> {
  const [row] = await tx.select().from(p).where(eq(p.code, code)).orderBy(desc(p.version)).limit(1);
  return row ? toPlan(row) : null;
}

async function assertAccount(tx: TenantTx, accountId: string) {
  const [row] = await tx
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(eq(schema.accounts.id, accountId));
  if (!row) throw new BillingAccountNotFoundError(accountId);
}

async function snapshotWritten(tx: TenantTx, since: Date) {
  const [row] = await tx
    .select({ id: schema.outboxEvents.id })
    .from(schema.outboxEvents)
    .where(
      and(
        eq(schema.outboxEvents.type, 'billing.usage.snapshot.v1'),
        gte(schema.outboxEvents.createdAt, since),
      ),
    )
    .limit(1);
  return Boolean(row);
}

function audit(
  tx: TenantTx,
  action: OperatorAction,
  name: string,
  targetType: string,
  targetId: string,
  data: Record<string, unknown> = {},
) {
  return writePlatformAudit(tx, {
    actorUserId: action.actorUserId,
    actorName: action.actorName,
    action: name,
    targetType,
    targetId,
    reason: action.reason,
    data,
  });
}

const paymentQuery = (tx: TenantTx) =>
  tx
    .select(paymentColumns)
    .from(pay)
    .innerJoin(schema.accounts, eq(schema.accounts.id, pay.accountId))
    .innerJoin(p, and(eq(p.code, pay.planCode), eq(p.version, pay.planVersion)))
    .$dynamic();

async function paymentById(tx: TenantTx, id: string): Promise<PaymentRecord | null> {
  const [row] = await paymentQuery(tx).where(eq(pay.id, id)).limit(1);
  return (row as PaymentRecord | undefined) ?? null;
}

async function pendingPayment(tx: TenantTx, id: string): Promise<PaymentRecord> {
  const [locked] = await tx.select({ id: pay.id }).from(pay).where(eq(pay.id, id)).for('update');
  if (!locked) throw new PaymentNotFoundError(id);
  const payment = must(await paymentById(tx, id));
  if (payment.status !== 'pending') {
    throw new BillingStateError('The payment is no longer pending', { status: payment.status });
  }
  return payment;
}

/**
 * One subscription change: the row, the integration event, the platform audit and the
 * `billing.plan_set` audit in every business of the account, in the caller's transaction.
 */
async function changeSubscription(
  tx: TenantTx,
  input: SubscriptionChangeInput,
): Promise<AccountSubscriptionRow | null> {
  const { accountId, action } = input;
  await assertAccount(tx, accountId);
  const [currentRow] = await tx.select().from(s).where(eq(s.accountId, accountId)).for('update');
  const current = currentRow ? toSub(currentRow) : null;
  if (input.expectedVersion !== 'any' && (current?.version ?? null) !== input.expectedVersion) {
    throw new BillingVersionConflictError('subscription');
  }
  const next = input.next(current);
  if (!next) return null;
  const [plan] = await tx
    .select()
    .from(p)
    .where(and(eq(p.code, next.planCode), eq(p.version, next.planVersion)));
  if (!plan) throw new PlanUnknownError(next.planCode);
  const now = new Date();
  const statusChanged = current?.status !== next.status;
  const periodMoved =
    current?.currentPeriodEnd?.getTime() !== next.currentPeriodEnd?.getTime() ||
    current?.planCode !== next.planCode;
  const values = {
    planCode: next.planCode,
    planVersion: next.planVersion,
    periodMonths: next.periodMonths,
    status: next.status,
    currentPeriodStart: next.currentPeriodStart,
    currentPeriodEnd: next.currentPeriodEnd,
    ...(next.cycleAnchor ? { cycleAnchor: next.cycleAnchor } : {}),
    ...(statusChanged ? { statusChangedAt: now } : {}),
    ...(periodMoved || statusChanged ? { remindersSent: {} } : {}),
    updatedAt: now,
  };
  const [row] = current
    ? await tx
        .update(s)
        .set({ ...values, version: sql`${s.version} + 1` })
        .where(eq(s.accountId, accountId))
        .returning()
    : await tx
        .insert(s)
        .values({ accountId, ...values, cycleAnchor: next.cycleAnchor ?? now })
        .returning();
  const saved = toSub(must(row));
  await writeSystemOutbox(tx, {
    type: 'billing.subscription.changed.v1',
    aggregateType: 'account',
    aggregateId: accountId,
    payload: {
      type: 'billing.subscription.changed.v1',
      accountId,
      planCode: plan.code,
      planVersion: plan.version,
      planName: plan.name,
      periodMonths: saved.periodMonths,
      status: saved.status,
      periodStart: saved.currentPeriodStart.toISOString(),
      periodEnd: iso(saved.currentPeriodEnd),
      mrrVnd: mrrVnd(plan, saved),
      reason: input.reason,
      occurredAt: now.toISOString(),
    },
  });
  const data = {
    from: current
      ? { plan: current.planCode, version: current.planVersion, status: current.status }
      : null,
    plan: saved.planCode,
    version: saved.planVersion,
    status: saved.status,
    months: saved.periodMonths,
    periodEnd: iso(saved.currentPeriodEnd),
    reason: input.reason,
    ...input.auditData,
  };
  if (input.auditAction) {
    await audit(tx, action, input.auditAction, 'account', accountId, data);
  }
  const businesses = await tx
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.accountId, accountId));
  for (const b of businesses) {
    await writeAudit(tx, {
      workspaceId: workspaceId(b.id),
      actorUserId: action.actorUserId,
      actorName: action.actorName ?? 'system',
      action: 'billing.plan_set',
      targetType: 'subscription',
      targetId: accountId,
      data,
    });
  }
  return saved;
}
