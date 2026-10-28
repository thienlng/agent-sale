import type { WorkspaceId } from '@agent-sales/shared';

import type { OverrideRecord, PlanRecord, SubscriptionRecord } from '../../domain/entitlements.js';
import type { ReserveResult } from '../../domain/usage.js';

/** Everything that decides a business's entitlements (ADR-012 §5). */
export interface BillingState {
  /** The business's own subscription (null = none), under tenant RLS. */
  subscription: SubscriptionRecord | null;
  overrides: OverrideRecord[];
  /**
   * The account's subscription, which wins over the business's. Until the backfill copied one,
   * the account's most expensive paid business subscription (the backfill's rule), so every
   * business of the account shares one plan, allowance and cycle.
   */
  accountSubscription: SubscriptionRecord | null;
  accountOverrides: OverrideRecord[];
}

export interface BillingStore {
  /** Business state under tenant RLS; account state (when `accountId`) with the system role. */
  state(ws: WorkspaceId, accountId: string | null): Promise<BillingState>;
  /** One version of a plan (platform catalog, system role). */
  plan(code: string, version: number): Promise<PlanRecord | null>;
  /**
   * Reserves one reply of the account's allowance for `key`, serialized per account. A key that
   * is already reserved (fresh) or captured is not counted again; `limit` caps the captured and
   * fresh reserved replies of the cycle.
   */
  reserve(input: {
    accountId: string;
    workspaceId: WorkspaceId;
    key: string;
    cycleStart: Date;
    limit: number;
    conversationId: string | null;
    botId: string | null;
    now: Date;
  }): Promise<ReserveResult>;
  /** The reply was delivered: it counts. No-op when nothing was reserved for `key`. */
  capture(ws: WorkspaceId, key: string, now: Date): Promise<void>;
  /** The reply was not delivered: the reservation stops counting. */
  release(ws: WorkspaceId, key: string, now: Date): Promise<void>;
  /** Captured replies of the cycle plus reservations younger than the TTL. */
  used(accountId: string, cycleStart: Date, now: Date): Promise<number>;
}

export const BILLING_STORE = Symbol('BILLING_STORE');
