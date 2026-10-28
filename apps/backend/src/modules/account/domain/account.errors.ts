import { DomainError } from '@agent-sales/shared';

/** Also returned when the account exists but the caller does not own it (no existence leak). */
export class AccountNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Account not found', { id });
  }
}

/** The caller owns several accounts and did not say which one the new business belongs to. */
export class AccountChoiceRequiredError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('Choose the account that owns the new business', {});
  }
}
