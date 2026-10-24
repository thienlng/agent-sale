import { DomainError } from '@agent-sales/shared';

export class AuditUnavailableError extends DomainError {
  readonly code = 'UNAVAILABLE';
  constructor() {
    super('The audit trail needs a database (DATABASE_URL is not configured)');
  }
}
