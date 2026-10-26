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
