import { DomainError } from '@agent-sales/shared';

export class PlanNotFoundError extends DomainError {
  readonly code = 'INTERNAL';
  constructor(code: string, version: number) {
    super('The workspace plan is missing from the catalog', { code, version });
  }
}

export class BillingUnavailableError extends DomainError {
  readonly code = 'UNAVAILABLE';
  constructor() {
    super('Plans need a database (DATABASE_URL is not configured)');
  }
}

/** Unknown plan code (admin actions). */
export class PlanUnknownError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(code: string) {
    super('Plan not found', { code });
  }
}

/** A plan body or an action breaks a catalog rule. */
export class PlanRuleError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

export class PlanCodeInUseError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(code: string, usedAs: string) {
    super(`The plan is used as ${usedAs}`, { code, usedAs });
  }
}

/** Someone changed the row since the operator loaded it (optimistic version). */
export class BillingVersionConflictError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(what: string) {
    super(`The ${what} was changed by someone else; reload and try again`, { what });
  }
}

/** The action does not fit the current state (not on trial, payment not pending, …). */
export class BillingStateError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

export class PaymentNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Payment not found', { id });
  }
}

export class BillingAccountNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(accountId: string) {
    super('Account not found', { accountId });
  }
}
