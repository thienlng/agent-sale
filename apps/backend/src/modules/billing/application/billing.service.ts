import type { EntitlementsDto, MessageUsageDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { BillingFacade, ReplyMeterKey, ReserveOutcome } from '../api/billing.facade.js';
import {
  FREE_PLAN,
  limitOf,
  type PlanRecord,
  resolveEntitlements,
} from '../domain/entitlements.js';
import { PlanNotFoundError } from '../domain/billing.errors.js';
import { cycleOf, FREE_CYCLE_ANCHOR } from '../domain/usage.js';
import { BILLING_STORE, type BillingStore } from './ports/billing-store.js';

const PLAN_CACHE_MS = 60_000;
/** A business never changes account, so its account id is cached once known. */
const ACCOUNT_CACHE_MAX = 10_000;
/** When the plan defines no cycle length. */
const DEFAULT_PERIOD_DAYS = 30;

interface Resolved {
  accountId: string | null;
  entitlements: EntitlementsDto;
  anchor: Date;
}

/** Plans, entitlements and the account's message allowance (docs/08 §3, ADR-012 §5). */
@Injectable()
export class BillingService implements BillingFacade {
  readonly #plans = new Map<string, { at: number; plan: PlanRecord }>();
  readonly #accounts = new Map<string, string>();

  constructor(
    @Inject(BILLING_STORE) private readonly store: BillingStore,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
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
    // A business the account backfill has not linked yet has no allowance to count against.
    if (!r.accountId) return { allowed: true, metered: false };
    const { limit, cycle } = this.#allowance(r, now);
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
    const accountId = await this.#accountOf(ws);
    const s = await this.store.state(ws, accountId);
    const subscription = s.accountSubscription ?? s.subscription;
    const plan = await this.#plan(
      subscription?.planCode ?? FREE_PLAN.code,
      subscription?.planVersion ?? FREE_PLAN.version,
    );
    return {
      accountId,
      entitlements: resolveEntitlements(plan, subscription, [
        ...s.accountOverrides,
        ...s.overrides,
      ]),
      anchor: subscription?.cycleAnchor ?? FREE_CYCLE_ANCHOR,
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

  /** Plan versions never change once published, so a short cache is always correct. */
  async #plan(code: string, version: number): Promise<PlanRecord> {
    const key = `${code}@${version}`;
    const hit = this.#plans.get(key);
    if (hit && Date.now() - hit.at < PLAN_CACHE_MS) return hit.plan;
    const plan = await this.store.plan(code, version);
    if (!plan) throw new PlanNotFoundError(code, version);
    this.#plans.set(key, { at: Date.now(), plan });
    return plan;
  }
}
