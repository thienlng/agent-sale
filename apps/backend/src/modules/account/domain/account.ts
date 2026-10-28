import type { UserId } from '@agent-sales/shared';

import { AccountChoiceRequiredError, AccountNotFoundError } from './account.errors.js';

export type AccountRole = 'owner' | 'billing';

/**
 * ADR-012 §3: the account a new business goes under. An explicit account must be owned
 * by the caller; otherwise the caller's only owned account; none → create one (null);
 * several → the caller has to choose.
 */
export function pickAccountForNewBusiness(input: {
  requested: string | undefined;
  owned: readonly string[];
}): string | null {
  if (input.requested !== undefined) {
    if (!input.owned.includes(input.requested)) throw new AccountNotFoundError(input.requested);
    return input.requested;
  }
  if (input.owned.length > 1) throw new AccountChoiceRequiredError();
  return input.owned[0] ?? null;
}

export function accountNameFor(businessName: string): string {
  return businessName.trim().slice(0, 120);
}

/** An account the user belongs to, with their account role (never business access). */
export interface AccountMembership {
  accountId: string;
  name: string;
  role: AccountRole;
}

export interface NewAccount {
  id: string;
  name: string;
  ownerUserId: UserId;
}
