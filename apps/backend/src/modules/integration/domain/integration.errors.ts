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

/** KiotViet refused a write as invalid (4xx other than auth): retrying the same body cannot help. */
export class KiotVietRejectedError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(readonly status: number) {
    super('KiotViet rejected the request', { reason: 'kiotviet_rejected', status });
  }
}

/** The settings name branches the KiotViet store does not have. */
export class KiotVietBranchError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(readonly branchIds: number[]) {
    super('These branches do not exist in the KiotViet store', {
      reason: 'kiotviet_branch',
      branchIds,
    });
  }
}

/** New credentials must belong to the connected store: a different one would mix up product links. */
export class KiotVietRetailerChangedError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('New credentials must be for the connected KiotViet store', {
      reason: 'kiotviet_retailer_changed',
    });
  }
}

/** An update request with neither settings nor credentials. */
export class NothingToUpdateError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('Send settings, credentials or both', { reason: 'nothing_to_update' });
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

/** The connect step failed after the connection was stored: only disconnect + connect again fixes it. */
export class ConnectFailedError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('The connection did not finish connecting; disconnect and connect again', {
      reason: 'connect_failed',
    });
  }
}

/** The connection changed since it was read (optimistic `version` check). */
export class ConnectionVersionConflictError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('The connection was changed by someone else; reload and retry', {
      reason: 'connection_version',
    });
  }
}

/** The process runs without a database, so the integration cannot store anything. */
export class IntegrationUnavailableError extends DomainError {
  readonly code = 'UNAVAILABLE';
  constructor() {
    super('PMS integrations need a database (DATABASE_URL is not configured)');
  }
}
