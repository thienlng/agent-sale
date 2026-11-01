import { DomainError } from '@agent-sales/shared';

export type LodgingErrorCode =
  'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_FAILED' | 'NIGHTS_TAKEN' | 'STALE_VERSION';

/** Every lodging domain/application failure; `code` maps to the HTTP error code. */
export class LodgingError extends DomainError {
  constructor(
    readonly code: LodgingErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

/** Lodging needs PostgreSQL; without DATABASE_URL every call answers 503. */
export class LodgingUnavailableError extends DomainError {
  readonly code = 'UNAVAILABLE';
  constructor() {
    super('Lodging needs a database (DATABASE_URL is not configured)');
  }
}
