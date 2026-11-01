import { DomainError } from '@agent-sales/shared';

/**
 * Connect-wizard errors are 400 VALIDATION_FAILED with `details.reason`, so the UI can show the
 * message under the right field (spec §8). Never put credentials in details.
 */

/** Token call rejected: wrong Client ID or secret. */
export class KiotVietAuthError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('KiotViet rejected the client id or secret', { reason: 'kiotviet_auth' });
  }
}

/** Valid token, but the store name is unknown to KiotViet. */
export class KiotVietRetailerError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('KiotViet store not found', { reason: 'kiotviet_retailer' });
  }
}

/** The API connection lacks permissions the integration needs. */
export class KiotVietPermissionError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(readonly missing: string[]) {
    super('The KiotViet API connection lacks permissions', {
      reason: 'kiotviet_permission',
      missing,
    });
  }
}

/** KiotViet is down, timing out or rate limiting beyond retries. */
export class KiotVietUnavailableError extends DomainError {
  readonly code = 'UNAVAILABLE';
  constructor() {
    super('KiotViet is not reachable right now', { reason: 'kiotviet_unavailable' });
  }
}

export class ConnectionExistsError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(provider: string) {
    super('This workspace is already connected to the provider', { provider });
  }
}

export class ConnectionNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(provider: string) {
    super('Integration connection not found', { provider });
  }
}

export class SyncAlreadyRunningError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('A sync is already running for this connection', { reason: 'sync_running' });
  }
}
