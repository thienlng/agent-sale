import {
  type AdminOverrideDto,
  type AdminPaymentDto,
  type AdminPaymentList,
  type AdminPaymentListQuery,
  type AdminPlanDto,
  type AdminSubscriptionDto,
  type ArchivePlanRequest,
  type BillingSettingsDto,
  type ConfirmPaymentRequest,
  type CreatePaymentRequest,
  type CreatePlanRequest,
  ENTITLEMENT_KEYS,
  type ExtendTrialRequest,
  PlanEntitlements,
  type PublishPlanVersionRequest,
  type PutBillingSettingsRequest,
  type PutOverrideRequest,
  type SetAccountPlanRequest,
} from '@agent-sales/contracts';
import { Inject, Injectable } from '@nestjs/common';

import type {
  AccountBillingView,
  AdminActor,
  BillingAccountFilter,
  BillingAccountMatch,
  BillingAdminFacade,
} from '../api/billing-admin.facade.js';
import { BillingStateError, PlanRuleError, PlanUnknownError } from '../domain/billing.errors.js';
import { FREE_PLAN } from '../domain/entitlements.js';
import { trialEnded } from '../domain/lifecycle.js';
import { newPaymentCode, paidPeriod, paymentAmount, vietQrUrl } from '../domain/payment.js';
import {
  addDays,
  addMonths,
  assertArchivable,
  assertPlanBody,
  type CatalogPlan,
  type PlanBody,
} from '../domain/plan-catalog.js';
import { BillingCatalog } from './billing-catalog.js';
import { BillingService } from './billing.service.js';
import {
  type AccountSubscriptionRow,
  type AdminOverrideRecord,
  BILLING_ADMIN_STORE,
  type BillingAdminStore,
  type BillingSettings,
  type OperatorAction,
  type PaymentRecord,
} from './ports/billing-admin-store.js';

/** When the settings leave the trial length empty and an operator puts an account on a trial. */
const DEFAULT_TRIAL_DAYS = 14;
const PAYMENTS_IN_DETAIL = 20;

const iso = (d: Date | null) => d?.toISOString() ?? null;
const action = (actor: AdminActor, reason: string): OperatorAction => ({
  actorUserId: actor.userId,
  actorName: actor.name,
  reason,
});

const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
function decodeCursor(cursor: string | undefined) {
  if (!cursor) return undefined;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(at ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) {
    throw new PlanRuleError('Invalid cursor');
  }
  return { createdAt, id };
}

const planBody = (req: CreatePlanRequest | PublishPlanVersionRequest): PlanBody => ({
  name: req.name,
  description: req.description,
  isPublic: req.isPublic,
  sortOrder: req.sortOrder,
  priceByPeriod: req.priceByPeriod as Record<string, number>,
  entitlements: req.entitlements,
});

const toPlanDto = (plan: CatalogPlan, subscriberCount = 0): AdminPlanDto => ({
  code: plan.code,
  version: plan.version,
  name: plan.name,
  description: plan.description,
  isPublic: plan.isPublic,
  archived: plan.archivedAt !== null,
  sortOrder: plan.sortOrder,
  priceByPeriod: plan.priceByPeriod,
  entitlements: plan.entitlements,
  subscriberCount,
  createdAt: plan.createdAt.toISOString(),
});

const toSettingsDto = (s: BillingSettings): BillingSettingsDto => ({
  trialEnabled: s.trialEnabled,
  trialPlanCode: s.trialPlanCode,
  trialDays: s.trialDays,
  afterTrialPlanCode: s.afterTrialPlanCode,
  hqContactScope: s.hqContactScope,
  graceDays: s.graceDays,
  suspendDays: s.suspendDays,
  bankBin: s.bankBin,
  bankAccountNo: s.bankAccountNo,
  bankAccountName: s.bankAccountName,
  version: s.version,
  updatedAt: s.updatedAt.toISOString(),
});

const toOverrideDto = (o: AdminOverrideRecord): AdminOverrideDto => ({
  key: o.key,
  value: o.value,
  reason: o.reason,
  expiresAt: iso(o.expiresAt),
  createdAt: o.createdAt.toISOString(),
});

/** Platform admin side of billing (ADR-021 §6). */
@Injectable()
export class BillingAdminService implements BillingAdminFacade {
  constructor(
    @Inject(BILLING_ADMIN_STORE) private readonly store: BillingAdminStore,
    @Inject(BillingCatalog) private readonly catalog: BillingCatalog,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  /** `next` always returns a change here, so the store returns the written row. */
  #written<T>(row: T | null): T {
    if (!row) throw new BillingStateError('The subscription was not written');
    return row;
  }

  // ─── Plan catalog ──────────────────────────────────────────────────────────

  async listPlans(): Promise<AdminPlanDto[]> {
    return (await this.store.listPlans()).map((p) => toPlanDto(p, p.subscriberCount));
  }

  async createPlan(req: CreatePlanRequest, actor: AdminActor): Promise<AdminPlanDto> {
    const body = planBody(req);
    assertPlanBody(req.code, body);
    const plan = await this.store.createPlan(req.code, body, action(actor, req.reason));
    this.catalog.invalidate();
    return toPlanDto(plan);
  }

  async publishPlanVersion(
    code: string,
    req: PublishPlanVersionRequest,
    actor: AdminActor,
  ): Promise<AdminPlanDto> {
    const body = planBody(req);
    assertPlanBody(code, body);
    const plan = await this.store.publishPlanVersion(
      code,
      body,
      req.expectedVersion,
      action(actor, req.reason),
    );
    this.catalog.invalidate();
    return toPlanDto(plan);
  }

  async archivePlan(
    code: string,
    req: ArchivePlanRequest,
    actor: AdminActor,
  ): Promise<AdminPlanDto> {
    const plan = await this.store.archivePlan(
      code,
      req.archived,
      (settings) => assertArchivable(code, settings),
      action(actor, req.reason),
    );
    this.catalog.invalidate();
    return toPlanDto(plan);
  }

  // ─── Settings ──────────────────────────────────────────────────────────────

  async settings(): Promise<BillingSettingsDto> {
    return toSettingsDto(await this.store.settings());
  }

  async putSettings(
    req: PutBillingSettingsRequest,
    actor: AdminActor,
  ): Promise<BillingSettingsDto> {
    const { expectedVersion, reason, ...next } = req;
    const saved = await this.store.putSettings(next, expectedVersion, action(actor, reason));
    this.catalog.invalidate();
    return toSettingsDto(saved);
  }

  // ─── Accounts ──────────────────────────────────────────────────────────────

  async subscriptionsOf(accountIds: readonly string[]): Promise<Map<string, AdminSubscriptionDto>> {
    const rows = await this.store.subscriptions(accountIds);
    const now = new Date();
    const out = new Map<string, AdminSubscriptionDto>();
    for (const row of rows) out.set(row.accountId, await this.#subscriptionDto(row, now));
    return out;
  }

  async matchAccounts(filter: BillingAccountFilter): Promise<BillingAccountMatch | null> {
    if (!filter.subscriptionStatus && !filter.planCode && !filter.endingWithinDays) return null;
    return this.store.matchAccounts(filter, new Date());
  }

  async accountBilling(accountId: string): Promise<AccountBillingView> {
    const [overrides, usage, payments, settings] = await Promise.all([
      this.store.overrides(accountId),
      this.billing.accountAllowance(accountId),
      this.store.listPayments({ accountId, limit: PAYMENTS_IN_DETAIL }),
      this.catalog.settings(),
    ]);
    return {
      overrides: overrides.map(toOverrideDto),
      usage: {
        used: usage.used,
        limit: usage.limit,
        cycleStart: usage.cycleStart.toISOString(),
        cycleEnd: usage.cycleEnd.toISOString(),
      },
      payments: payments.map((p) => toPaymentDto(p, settings)),
    };
  }

  async setAccountPlan(
    accountId: string,
    req: SetAccountPlanRequest,
    actor: AdminActor,
  ): Promise<AdminSubscriptionDto> {
    const plan = await this.#sellable(req.planCode);
    const priced = Object.keys(plan.priceByPeriod).length > 0;
    if (req.status === 'active' && priced && req.periodMonths === null) {
      throw new PlanRuleError('A paid plan needs a period', { code: plan.code });
    }
    if (!priced && req.periodMonths !== null) {
      throw new PlanRuleError('A plan without prices has no period', { code: plan.code });
    }
    const settings = await this.catalog.settings();
    const start = req.startsAt ? new Date(req.startsAt) : new Date();
    const end =
      req.status === 'trialing'
        ? addDays(start, settings.trialDays ?? DEFAULT_TRIAL_DAYS)
        : req.periodMonths !== null
          ? addMonths(start, req.periodMonths)
          : null;
    const saved = await this.store.changeSubscription({
      accountId,
      expectedVersion: req.expectedVersion,
      next: () => ({
        planCode: plan.code,
        planVersion: plan.version,
        periodMonths: req.status === 'trialing' ? null : req.periodMonths,
        status: req.status,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        cycleAnchor: start,
      }),
      reason: 'admin',
      action: action(actor, req.reason),
      auditAction: 'billing.subscription.set',
    });
    return this.#subscriptionDto(this.#written(saved), new Date());
  }

  async extendTrial(
    accountId: string,
    req: ExtendTrialRequest,
    actor: AdminActor,
  ): Promise<AdminSubscriptionDto> {
    const until = new Date(req.until);
    if (until.getTime() <= Date.now()) {
      throw new PlanRuleError('The new trial end must be in the future');
    }
    const saved = await this.store.changeSubscription({
      accountId,
      expectedVersion: req.expectedVersion,
      next: (current) => {
        if (current?.status !== 'trialing') {
          throw new BillingStateError('The account is not on a trial');
        }
        return {
          planCode: current.planCode,
          planVersion: current.planVersion,
          periodMonths: current.periodMonths,
          status: 'trialing',
          currentPeriodStart: current.currentPeriodStart,
          currentPeriodEnd: until,
        };
      },
      reason: 'admin',
      action: action(actor, req.reason),
      auditAction: 'billing.trial.extended',
    });
    return this.#subscriptionDto(this.#written(saved), new Date());
  }

  async putOverride(
    accountId: string,
    key: string,
    req: PutOverrideRequest,
    actor: AdminActor,
  ): Promise<AdminOverrideDto> {
    if (!(key in ENTITLEMENT_KEYS)) throw new PlanRuleError('Unknown entitlement key', { key });
    const schema = PlanEntitlements.shape[key as keyof typeof ENTITLEMENT_KEYS];
    if (!schema.safeParse(req.value).success) {
      throw new PlanRuleError('Invalid value for the entitlement', { key });
    }
    const expiresAt = req.expiresAt ? new Date(req.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new PlanRuleError('The override must expire in the future');
    }
    const saved = await this.store.putOverride(
      accountId,
      { key, value: req.value, expiresAt },
      action(actor, req.reason),
    );
    return toOverrideDto(saved);
  }

  async deleteOverride(
    accountId: string,
    key: string,
    reason: string,
    actor: AdminActor,
  ): Promise<void> {
    if (!(await this.store.deleteOverride(accountId, key, action(actor, reason)))) {
      throw new BillingStateError('No override for this key', { key });
    }
  }

  // ─── Payments ──────────────────────────────────────────────────────────────

  async listPayments(query: AdminPaymentListQuery): Promise<AdminPaymentList> {
    const rows = await this.store.listPayments({
      ...(query.status ? { status: query.status } : {}),
      cursor: decodeCursor(query.cursor),
      limit: query.limit + 1,
    });
    const settings = await this.catalog.settings();
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map((p) => toPaymentDto(p, settings)),
      page: {
        nextCursor:
          rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
      },
    };
  }

  async createPayment(
    accountId: string,
    req: CreatePaymentRequest,
    actor: AdminActor,
  ): Promise<AdminPaymentDto> {
    const plan = await this.#sellable(req.planCode);
    const amountVnd = paymentAmount(plan, req.periodMonths, req.amountVnd);
    const payment = await this.store.createPayment(
      {
        accountId,
        code: newPaymentCode(),
        planCode: plan.code,
        planVersion: plan.version,
        periodMonths: req.periodMonths,
        amountVnd,
        note: req.note,
      },
      action(actor, req.reason),
    );
    return toPaymentDto(payment, await this.catalog.settings());
  }

  async confirmPayment(
    paymentId: string,
    req: ConfirmPaymentRequest,
    actor: AdminActor,
  ): Promise<AdminPaymentDto> {
    const now = new Date();
    const payment = await this.store.confirmPayment(
      paymentId,
      req.bankReference,
      (p) => ({
        expectedVersion: 'any',
        next: (current) => {
          const period = paidPeriod(current, p.periodMonths, now);
          // Paying ahead continues the running cycles; a new period restarts them.
          const continues = period.start.getTime() !== now.getTime();
          return {
            planCode: p.planCode,
            planVersion: p.planVersion,
            periodMonths: p.periodMonths,
            status: 'active',
            currentPeriodStart: period.start,
            currentPeriodEnd: period.end,
            ...(continues ? {} : { cycleAnchor: now }),
          };
        },
        reason: 'payment',
        auditAction: 'billing.subscription.paid',
        auditData: { paymentId: p.id, code: p.code, amountVnd: p.amountVnd },
      }),
      action(actor, req.reason),
    );
    return toPaymentDto(payment, await this.catalog.settings());
  }

  async cancelPayment(
    paymentId: string,
    reason: string,
    actor: AdminActor,
  ): Promise<AdminPaymentDto> {
    const payment = await this.store.cancelPayment(paymentId, action(actor, reason));
    return toPaymentDto(payment, await this.catalog.settings());
  }

  /** The latest version of a code, if it may be sold (not archived). */
  async #sellable(code: string): Promise<CatalogPlan> {
    const plan = await this.store.latestPlan(code);
    if (!plan) throw new PlanUnknownError(code);
    if (plan.archivedAt) throw new BillingStateError('The plan is archived', { code });
    return plan;
  }

  async #subscriptionDto(row: AccountSubscriptionRow, now: Date): Promise<AdminSubscriptionDto> {
    const plan = await this.catalog.plan(row.planCode, row.planVersion);
    const ref = { code: plan.code, version: plan.version, name: plan.name };
    let effective = ref;
    if (trialEnded(row, now)) {
      const settings = await this.catalog.settings();
      const after =
        (await this.catalog.latest(settings.afterTrialPlanCode)) ??
        (await this.catalog.plan(FREE_PLAN.code, FREE_PLAN.version));
      effective = { code: after.code, version: after.version, name: after.name };
    }
    return {
      plan: ref,
      status: row.status as AdminSubscriptionDto['status'],
      effectivePlan: effective,
      periodMonths: row.periodMonths,
      periodStart: row.currentPeriodStart.toISOString(),
      periodEnd: iso(row.currentPeriodEnd),
      version: row.version,
    };
  }
}

function toPaymentDto(p: PaymentRecord, bank: BillingSettings): AdminPaymentDto {
  return {
    id: p.id,
    accountId: p.accountId,
    accountName: p.accountName,
    code: p.code,
    plan: { code: p.planCode, version: p.planVersion, name: p.planName },
    periodMonths: p.periodMonths,
    amountVnd: p.amountVnd,
    status: p.status,
    qrUrl: vietQrUrl(bank, p.amountVnd, p.code),
    bankReference: p.bankReference,
    note: p.note,
    confirmedAt: iso(p.confirmedAt),
    createdAt: p.createdAt.toISOString(),
  };
}
