import { DomainError } from '@agent-sales/shared';

export class SaasError extends DomainError {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_FAILED',
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

export class SaasUnavailableError extends DomainError {
  readonly code = 'UNAVAILABLE';
  constructor() {
    super('SaaS subscriptions need a database (DATABASE_URL is not configured)');
  }
}
