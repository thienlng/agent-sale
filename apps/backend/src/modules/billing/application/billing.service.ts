import {
  ENTITLEMENT_KEYS,
  type EntitlementsDto,
  type MessageUsageDto,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { BillingFacade, ReplyMeterKey, ReserveOutcome } from '../api/billing.facade.js';
import {
  FREE_PLAN,
  limitOf,
  type OverrideRecord,
  resolveEntitlements,
  type SubscriptionRecord,
} from '../domain/entitlements.js';
import { trialEnded } from '../domain/lifecycle.js';
import { addDays } from '../domain/plan-catalog.js';
import { cycleOf, FREE_CYCLE_ANCHOR } from '../domain/usage.js';
import { BillingCatalog } from './billing-catalog.js';
import { BILLING_ADMIN_STORE, type BillingAdminStore } from './ports/billing-admin-store.js';
import { BILLING_STORE, type BillingStore } from './ports/billing-store.js';

/** A business never changes account, so its account id is cached once known. */
const ACCOUNT_CACHE_MAX = 10_000;
/** When the plan defines no cycle length. */
const DEFAULT_PERIOD_DAYS = 30;

interface Resolved {
  accountId: string | null;
  entitlements: EntitlementsDto;
  anchor: Date;
  /** The account or its subscription is suspended: no AI reply (the bot hands off). */
  suspended: boolean;
  /** The owner deleted the business (ADR-032): entitled to nothing, metered or not. */
  inactive?: boolean;
}

/** An account's allowance in the current cycle (admin views, daily snapshot). */
export interface AccountAllowance {
  used: number;
  limit: number;
  cycleStart: Date;
  cycleEnd: Date;
}

/**
 * A business its owner deleted (ADR-032) is entitled to nothing: every limit 0 (including the
 * Brain and care daily caps), every feature off, no AI replies. This is the single gate that stops
 * bot replies (`reserveReply`), Brain evaluations, care messages and public API webhooks at once,
 * the way an account suspension stops replies.
 */
function inactiveBusiness(r: Resolved): Resolved {
  const limits: Record<string, number | null> = {};
  const features: Record<string, boolean> = {};
  for (const [key, kind] of Object.entries(ENTITLEMENT_KEYS)) {
    if (kind === 'limit') limits[key] = 0;
    if (kind === 'flag') features[key] = false;
  }
  for (const key of Object.keys(r.entitlements.limits)) limits[key] = 0;
  for (const key of Object.keys(r.entitlements.features)) features[key] = false;
  const periodDays = r.entitlements.aiIncludedMessages?.periodDays ?? DEFAULT_PERIOD_DAYS;
  return {
    ...r,
    suspended: true,
    inactive: true,
    entitlements: {
      ...r.entitlements,
      limits,
      features,
      aiModels: [],
      aiIncludedMessages: { amount: 0, periodDays },
    },
  };
}

/** Plans, entitlements and the account's message allowance (docs/08 §3, ADR-012 §5). */
@Injectable()
export class BillingService implements BillingFacade {
  readonly #accounts = new Map<string, string>();
  readonly #log = new Logger('BillingService');

  constructor(
    @Inject(BILLING_STORE) private readonly store: BillingStore,
    @Inject(BILLING_ADMIN_STORE) private readonly admin: BillingAdminStore,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(BillingCatalog) private readonly catalog: BillingCatalog,
  ) {}

  async entitlements(ws: WorkspaceId): Promise<EntitlementsDto> {
    return (await this.#resolve(ws)).entitlements;
  }

  async limit(ws: WorkspaceId, key: string): Promise<number | null> {
    return limitOf(await this.entitlements(ws), key);
  }

  async usage(ws: WorkspaceId): Promise<MessageUsageDto> {
    const now = new Date();
    const r = await this.#resolve(ws);
    const { limit, cycle } = this.#allowance(r, now);
    const used = r.accountId ? await this.store.used(r.accountId, cycle.start, now) : 0;
    return {
      metered: r.accountId !== null,
      used,
      limit,
      cycleStart: cycle.start.toISOString(),
      cycleEnd: cycle.end.toISOString(),
      exhausted: r.accountId !== null && used >= limit,
    };
  }

  async reserveReply(ws: WorkspaceId, reply: ReplyMeterKey): Promise<ReserveOutcome> {
    const now = new Date();
    const r = await this.#resolve(ws);
    if (r.inactive) {
      return {
        allowed: false,
        reason: 'account_suspended',
        cycleEnd: this.#allowance(r, now).cycle.end,
      };
    }
    // A business the account backfill has not linked yet has no allowance to count against.
    if (!r.accountId) return { allowed: true, metered: false };
    const { limit, cycle } = this.#allowance(r, now);
    if (r.suspended) return { allowed: false, reason: 'account_suspended', cycleEnd: cycle.end };
    const result = await this.store.reserve({
      accountId: r.accountId,
      workspaceId: ws,
      key: reply.idempotencyKey,
      cycleStart: cycle.start,
      limit,
      conversationId: reply.conversationId,
      botId: reply.botId,
      now,
    });
    return result === 'exhausted'
      ? { allowed: false, reason: 'allowance_exhausted', cycleEnd: cycle.end }
      : { allowed: true, metered: true };
  }

  captureReply(ws: WorkspaceId, idempotencyKey: string): Promise<void> {
    return this.store.capture(ws, idempotencyKey, new Date());
  }

  releaseReply(ws: WorkspaceId, idempotencyKey: string): Promise<void> {
    return this.store.release(ws, idempotencyKey, new Date());
  }

  async startSignupTrial(accountId: string): Promise<boolean> {
    const settings = await this.admin.settings();
    if (!settings.trialEnabled || !settings.trialPlanCode || !settings.trialDays) return false;
    const plan = await this.admin.latestPlan(settings.trialPlanCode);
    if (!plan || plan.archivedAt) {
      this.#log.warn(`Account ${accountId}: signup trial skipped, the trial plan is unavailable`);
      return false;
    }
    const days = settings.trialDays;
    const now = new Date();
    const saved = await this.admin.changeSubscription({
      accountId,
      expectedVersion: 'any',
      // Idempotent: an account that already has a subscription keeps it.
      next: (current) =>
        current
          ? null
          : {
              planCode: plan.code,
              planVersion: plan.version,
              periodMonths: null,
              status: 'trialing',
              currentPeriodStart: now,
              currentPeriodEnd: addDays(now, days),
              cycleAnchor: now,
            },
      reason: 'signup_trial',
      action: { actorUserId: null, actorName: 'system', reason: 'signup trial' },
    });
    return saved !== null;
  }

  /** The account's use of its allowance in the current cycle. */
  async accountAllowance(accountId: string, now: Date = new Date()): Promise<AccountAllowance> {
    const s = await this.store.accountState(accountId);
    const r = await this.#resolved(accountId, s.accountSubscription, s.accountOverrides, now);
    const { limit, cycle } = this.#allowance(r, now);
    const used = await this.store.used(accountId, cycle.start, now);
    return { used, limit, cycleStart: cycle.start, cycleEnd: cycle.end };
  }

  /** A plan without `ai.included_messages` allows no AI reply (deny by default, like limits). */
  #allowance(r: Resolved, now: Date) {
    const included = r.entitlements.aiIncludedMessages;
    return {
      limit: Math.max(0, Math.trunc(included?.amount ?? 0)),
      cycle: cycleOf(r.anchor, included?.periodDays ?? DEFAULT_PERIOD_DAYS, now),
    };
  }

  /**
   * The account's subscription and overrides first; until the backfill copied it, the business's
   * own subscription; else the free plan. Business overrides are applied last: they are per
   * business by nature (grandfathered seats).
   */
  async #resolve(ws: WorkspaceId): Promise<Resolved> {
    const [accountId, active] = await Promise.all([
      this.#accountOf(ws),
      this.workspaces.isActive(ws),
    ]);
    const s = await this.store.state(ws, accountId);
    const r = await this.#resolved(accountId, s.accountSubscription ?? s.subscription, [
      ...s.accountOverrides,
      ...s.overrides,
    ]);
    const resolved = { ...r, suspended: r.suspended || s.accountStatus === 'suspended' };
    return active ? resolved : inactiveBusiness(resolved);
  }

  async #resolved(
    accountId: string | null,
    stored: SubscriptionRecord | null,
    overrides: OverrideRecord[],
    now: Date = new Date(),
  ): Promise<Resolved> {
    const subscription = await this.#effective(stored, now);
    const plan = await this.catalog.plan(
      subscription?.planCode ?? FREE_PLAN.code,
      subscription?.planVersion ?? FREE_PLAN.version,
    );
    return {
      accountId,
      entitlements: resolveEntitlements(plan, subscription, overrides, now),
      anchor: subscription?.cycleAnchor ?? FREE_CYCLE_ANCHOR,
      suspended: subscription?.status === 'suspended',
    };
  }

  /**
   * Lazy trial expiry: a trial that ended gets the plan after the trial at once, the way the
   * lifecycle job will write it (cycles restart at the trial end), without waiting for the job.
   */
  async #effective(sub: SubscriptionRecord | null, now: Date): Promise<SubscriptionRecord | null> {
    if (!sub || !trialEnded(sub, now)) return sub;
    const settings = await this.catalog.settings();
    const after =
      (await this.catalog.latest(settings.afterTrialPlanCode)) ??
      (await this.catalog.latest(FREE_PLAN.code));
    const end = sub.currentPeriodEnd ?? now;
    return {
      planCode: after?.code ?? FREE_PLAN.code,
      planVersion: after?.version ?? FREE_PLAN.version,
      status: 'active',
      currentPeriodEnd: null,
      cycleAnchor: end,
    };
  }

  async #accountOf(ws: WorkspaceId): Promise<string | null> {
    const hit = this.#accounts.get(ws);
    if (hit) return hit;
    const accountId = await this.workspaces.accountOf(ws);
    if (accountId) {
      if (this.#accounts.size >= ACCOUNT_CACHE_MAX) this.#accounts.clear();
      this.#accounts.set(ws, accountId);
    }
    return accountId;
  }
}
