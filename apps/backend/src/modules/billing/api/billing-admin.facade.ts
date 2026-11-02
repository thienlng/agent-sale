import type {
  AdminOverrideDto,
  AdminPaymentDto,
  AdminPaymentList,
  AdminPaymentListQuery,
  AdminPlanDto,
  AdminSubscriptionDto,
  ArchivePlanRequest,
  BillingSettingsDto,
  ConfirmPaymentRequest,
  CreatePaymentRequest,
  CreatePlanRequest,
  ExtendTrialRequest,
  PublishPlanVersionRequest,
  PutBillingSettingsRequest,
  PutOverrideRequest,
  SetAccountPlanRequest,
} from '@agent-sales/contracts';

/** The platform operator acting in /admin (`userId: null` = the CLI or a job). */
export interface AdminActor {
  userId: string | null;
  name: string | null;
}

/** Accounts matching subscription filters: these ids, or every account except them. */
export interface BillingAccountMatch {
  ids: string[];
  exclude: boolean;
}

export interface BillingAccountFilter {
  subscriptionStatus?: string;
  planCode?: string;
  endingWithinDays?: number;
}

export interface AccountBillingView {
  overrides: AdminOverrideDto[];
  usage: { used: number; limit: number; cycleStart: string; cycleEnd: string } | null;
  payments: AdminPaymentDto[];
}

/**
 * PUBLIC CONTRACT for the platform admin (ADR-021 §6): plan catalog, billing settings, account
 * subscriptions, overrides and manual payments. Callers must already have checked the platform
 * admin flag; every write takes the operator's reason and is audited.
 */
export interface BillingAdminFacade {
  listPlans(): Promise<AdminPlanDto[]>;
  createPlan(req: CreatePlanRequest, actor: AdminActor): Promise<AdminPlanDto>;
  publishPlanVersion(
    code: string,
    req: PublishPlanVersionRequest,
    actor: AdminActor,
  ): Promise<AdminPlanDto>;
  archivePlan(code: string, req: ArchivePlanRequest, actor: AdminActor): Promise<AdminPlanDto>;

  settings(): Promise<BillingSettingsDto>;
  putSettings(req: PutBillingSettingsRequest, actor: AdminActor): Promise<BillingSettingsDto>;

  /** Subscriptions of the given accounts, keyed by account id (absent = free, no row). */
  subscriptionsOf(accountIds: readonly string[]): Promise<Map<string, AdminSubscriptionDto>>;
  /** Null when the filter is empty (every account matches). */
  matchAccounts(filter: BillingAccountFilter): Promise<BillingAccountMatch | null>;
  accountBilling(accountId: string): Promise<AccountBillingView>;

  setAccountPlan(
    accountId: string,
    req: SetAccountPlanRequest,
    actor: AdminActor,
  ): Promise<AdminSubscriptionDto>;
  extendTrial(
    accountId: string,
    req: ExtendTrialRequest,
    actor: AdminActor,
  ): Promise<AdminSubscriptionDto>;
  putOverride(
    accountId: string,
    key: string,
    req: PutOverrideRequest,
    actor: AdminActor,
  ): Promise<AdminOverrideDto>;
  deleteOverride(accountId: string, key: string, reason: string, actor: AdminActor): Promise<void>;

  listPayments(query: AdminPaymentListQuery): Promise<AdminPaymentList>;
  createPayment(
    accountId: string,
    req: CreatePaymentRequest,
    actor: AdminActor,
  ): Promise<AdminPaymentDto>;
  confirmPayment(
    paymentId: string,
    req: ConfirmPaymentRequest,
    actor: AdminActor,
  ): Promise<AdminPaymentDto>;
  cancelPayment(paymentId: string, reason: string, actor: AdminActor): Promise<AdminPaymentDto>;
}

export const BILLING_ADMIN_FACADE = Symbol('BILLING_ADMIN_FACADE');

/** Worker hook: subscription lifecycle, reminders and the daily usage snapshot. */
export interface BillingRunner {
  tick(now?: Date): Promise<void>;
}

export const BILLING_RUNNER = Symbol('BILLING_RUNNER');
