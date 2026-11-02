import { DomainError } from '@agent-sales/shared';

export class AdminAccountNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(accountId: string) {
    super('Account not found', { accountId });
  }
}

export class InvalidAdminCursorError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('Invalid cursor');
  }
}

export class BackofficeUnavailableError extends DomainError {
  readonly code = 'UNAVAILABLE';
  constructor() {
    super('The platform admin needs a database (DATABASE_URL is not configured)');
  }
}
