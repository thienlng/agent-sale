import type { BillingAdminStore } from '../../application/ports/billing-admin-store.js';
import type { BillingStore } from '../../application/ports/billing-store.js';
import { BillingUnavailableError } from '../../domain/billing.errors.js';

/** Without a database, plan, entitlement and usage routes answer 503. */
export class UnavailableBillingStore implements BillingStore {
  state(): never {
    throw new BillingUnavailableError();
  }
  accountState(): never {
    throw new BillingUnavailableError();
  }
  plan(): never {
    throw new BillingUnavailableError();
  }
  reserve(): never {
    throw new BillingUnavailableError();
  }
  capture(): never {
    throw new BillingUnavailableError();
  }
  release(): never {
    throw new BillingUnavailableError();
  }
  used(): never {
    throw new BillingUnavailableError();
  }
}

const unavailable = () => Promise.reject(new BillingUnavailableError());

/** Without a database, every admin method rejects with 503. */
export class UnavailableBillingAdminStore implements BillingAdminStore {
  listPlans(): Promise<never> {
    return unavailable();
  }
  latestPlan(): Promise<never> {
    return unavailable();
  }
  createPlan(): Promise<never> {
    return unavailable();
  }
  publishPlanVersion(): Promise<never> {
    return unavailable();
  }
  archivePlan(): Promise<never> {
    return unavailable();
  }
  settings(): Promise<never> {
    return unavailable();
  }
  putSettings(): Promise<never> {
    return unavailable();
  }
  subscriptions(): Promise<never> {
    return unavailable();
  }
  matchAccounts(): Promise<never> {
    return unavailable();
  }
  changeSubscription(): Promise<never> {
    return unavailable();
  }
  overrides(): Promise<never> {
    return unavailable();
  }
  putOverride(): Promise<never> {
    return unavailable();
  }
  deleteOverride(): Promise<never> {
    return unavailable();
  }
  listPayments(): Promise<never> {
    return unavailable();
  }
  payment(): Promise<never> {
    return unavailable();
  }
  createPayment(): Promise<never> {
    return unavailable();
  }
  confirmPayment(): Promise<never> {
    return unavailable();
  }
  cancelPayment(): Promise<never> {
    return unavailable();
  }
  lifecycleCandidates(): Promise<never> {
    return unavailable();
  }
  sendReminder(): Promise<never> {
    return unavailable();
  }
  activeAccountIds(): Promise<never> {
    return unavailable();
  }
  snapshotWritten(): Promise<never> {
    return unavailable();
  }
  writeUsageSnapshots(): Promise<never> {
    return unavailable();
  }
}
