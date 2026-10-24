import type { BillingStore } from '../../application/ports/billing-store.js';
import { BillingUnavailableError } from '../../domain/billing.errors.js';

/** Without a database, plan and entitlement routes answer 503. */
export class UnavailableBillingStore implements BillingStore {
  workspaceState(): never {
    throw new BillingUnavailableError();
  }
  plan(): never {
    throw new BillingUnavailableError();
  }
}
