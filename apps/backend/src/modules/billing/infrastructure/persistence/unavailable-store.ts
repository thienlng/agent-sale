import type { BillingStore } from '../../application/ports/billing-store.js';
import { BillingUnavailableError } from '../../domain/billing.errors.js';

/** Without a database, plan, entitlement and usage routes answer 503. */
export class UnavailableBillingStore implements BillingStore {
  state(): never {
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
