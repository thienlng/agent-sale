import type { CatalogPlan, PlanBody } from '../../domain/plan-catalog.js';
import type { LifecycleSubscription } from '../../domain/lifecycle.js';
import type { BankAccount } from '../../domain/payment.js';
import type { OverrideRecord } from '../../domain/entitlements.js';

/** Who did it and why (platform admin; `actorUserId: null` = a job or the CLI). */
export interface OperatorAction {
  actorUserId: string | null;
  actorName: string | null;
  reason: string;
}

export interface BillingSettings extends BankAccount {
  trialEnabled: boolean;
  trialPlanCode: string | null;
  trialDays: number | null;
  afterTrialPlanCode: string;
  hqContactScope: 'owner' | 'owner_and_billing';
  graceDays: number;
  suspendDays: number;
  version: number;
  updatedAt: Date;
}

export type BillingSettingsInput = Omit<BillingSettings, 'version' | 'updatedAt'>;

/** An account's subscription row (migration 0031 + 0053). */
export interface AccountSubscriptionRow extends LifecycleSubscription {
  accountId: string;
  planVersion: number;
  currentPeriodStart: Date;
  cycleAnchor: Date;
  version: number;
}

/** What a change writes; the store bumps `version` and resets reminders when the period moves. */
export interface SubscriptionChange {
  planCode: string;
  planVersion: number;
  periodMonths: number | null;
  status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled';
  currentPeriodStart: Date;
  currentPeriodEnd: Date | null;
  /** Restart allowance cycles here (new plan or period); omitted = keep the anchor. */
  cycleAnchor?: Date;
}

export type SubscriptionChangeReason = 'signup_trial' | 'admin' | 'payment' | 'expiry' | 'cli';

export interface SubscriptionChangeInput {
  accountId: string;
  /** Optimistic check: `null` = there must be no row yet; `'any'` = no check (jobs). */
  expectedVersion: number | null | 'any';
  /** Computes the new row from the current one inside the transaction (null = no change). */
  next: (current: AccountSubscriptionRow | null) => SubscriptionChange | null;
  reason: SubscriptionChangeReason;
  action: OperatorAction;
  /** Platform audit action, e.g. `billing.subscription.set`; omitted for jobs. */
  auditAction?: string;
  auditData?: Record<string, unknown>;
}

export interface AdminOverrideRecord extends OverrideRecord {
  reason: string;
  createdAt: Date;
}

export interface PaymentRecord {
  id: string;
  accountId: string;
  accountName: string;
  code: string;
  planCode: string;
  planVersion: number;
  planName: string;
  periodMonths: number;
  amountVnd: number;
  status: 'pending' | 'confirmed' | 'canceled';
  bankReference: string | null;
  note: string;
  confirmedAt: Date | null;
  createdAt: Date;
}

export interface NewPayment {
  accountId: string;
  code: string;
  planCode: string;
  planVersion: number;
  periodMonths: number;
  amountVnd: number;
  note: string;
}

/** Account filters billing can answer: an id list, or the ids to leave out. */
export interface AccountMatch {
  ids: string[];
  exclude: boolean;
}

export interface AccountSubscriptionFilter {
  subscriptionStatus?: string;
  planCode?: string;
  endingWithinDays?: number;
}

/** Platform-side billing administration (ADR-021 §6). System role; every write is one transaction. */
export interface BillingAdminStore {
  /** Latest version of every code, plus older versions that still have subscribers. */
  listPlans(): Promise<(CatalogPlan & { subscriberCount: number })[]>;
  latestPlan(code: string): Promise<CatalogPlan | null>;
  createPlan(code: string, body: PlanBody, action: OperatorAction): Promise<CatalogPlan>;
  /** Inserts version `expectedVersion + 1`; conflict when the latest version is not `expectedVersion`. */
  publishPlanVersion(
    code: string,
    body: PlanBody,
    expectedVersion: number,
    action: OperatorAction,
  ): Promise<CatalogPlan>;
  /** Archives (or restores) every version of a code; `guard` runs with the current settings. */
  archivePlan(
    code: string,
    archived: boolean,
    guard: (settings: BillingSettings) => void,
    action: OperatorAction,
  ): Promise<CatalogPlan>;

  settings(): Promise<BillingSettings>;
  putSettings(
    next: BillingSettingsInput,
    expectedVersion: number,
    action: OperatorAction,
  ): Promise<BillingSettings>;

  subscriptions(accountIds: readonly string[]): Promise<AccountSubscriptionRow[]>;
  matchAccounts(filter: AccountSubscriptionFilter, now: Date): Promise<AccountMatch>;
  /**
   * Writes the account subscription, the `billing.subscription.changed.v1` event, the platform
   * audit (when `auditAction`) and a `billing.plan_set` audit in every business of the account.
   * Returns null when `next` decided nothing changes.
   */
  changeSubscription(input: SubscriptionChangeInput): Promise<AccountSubscriptionRow | null>;

  overrides(accountId: string): Promise<AdminOverrideRecord[]>;
  putOverride(
    accountId: string,
    override: OverrideRecord,
    action: OperatorAction,
  ): Promise<AdminOverrideRecord>;
  /** False when there was no override for the key. */
  deleteOverride(accountId: string, key: string, action: OperatorAction): Promise<boolean>;

  listPayments(query: {
    status?: PaymentRecord['status'];
    accountId?: string;
    cursor?: { createdAt: Date; id: string } | undefined;
    limit: number;
  }): Promise<PaymentRecord[]>;
  payment(id: string): Promise<PaymentRecord | null>;
  createPayment(input: NewPayment, action: OperatorAction): Promise<PaymentRecord>;
  /**
   * Marks a pending payment confirmed and applies `change` to the account subscription in the same
   * transaction. Conflict when the payment is not pending.
   */
  confirmPayment(
    id: string,
    bankReference: string | null,
    change: (payment: PaymentRecord) => Omit<SubscriptionChangeInput, 'action' | 'accountId'>,
    action: OperatorAction,
  ): Promise<PaymentRecord>;
  cancelPayment(id: string, action: OperatorAction): Promise<PaymentRecord>;

  /** Subscriptions the lifecycle job must look at: due transitions or reminders. */
  lifecycleCandidates(
    now: Date,
    horizonDays: number,
    limit: number,
  ): Promise<AccountSubscriptionRow[]>;
  /** Writes the reminder event and records its keys (no-op when already recorded). */
  sendReminder(
    accountId: string,
    keys: readonly string[],
    payload: Record<string, unknown>,
  ): Promise<boolean>;
  /** Active account ids after `afterId`, in id order (daily snapshot paging). */
  activeAccountIds(afterId: string | null, limit: number): Promise<string[]>;
  /** Whether the snapshots of the day starting at `since` were already written. */
  snapshotWritten(since: Date): Promise<boolean>;
  /**
   * Writes the day's `billing.usage.snapshot.v1` events in one transaction, serialized across
   * workers; false (nothing written) when another worker already wrote them.
   */
  writeUsageSnapshots(since: Date, payloads: readonly Record<string, unknown>[]): Promise<boolean>;
}

export const BILLING_ADMIN_STORE = Symbol('BILLING_ADMIN_STORE');
