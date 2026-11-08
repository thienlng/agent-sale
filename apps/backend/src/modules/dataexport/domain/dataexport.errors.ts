import { DomainError } from '@agent-sales/shared';

export class DataExportNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('Data export not found or no longer available');
  }
}

/** One export at a time per business. */
export class DataExportInProgressError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('A data export is already being prepared');
  }
}

export class DataExportNotReadyError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('The data export is not ready');
  }
}

export class DataExportDailyLimitError extends DomainError {
  readonly code = 'RATE_LIMITED';
  constructor(limit: number) {
    super('Daily data export limit reached', { limit });
  }
}

/** The private exports bucket is not configured (S3_* unset). */
export class DataExportUnavailableError extends DomainError {
  readonly code = 'UNAVAILABLE';
  constructor() {
    super('Data export storage is not configured');
  }
}
