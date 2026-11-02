import type { PlatformAuditStore } from '../../application/ports/platform-audit-store.js';
import { BackofficeUnavailableError } from '../../domain/backoffice.errors.js';

/** Without a database, the platform audit trail answers 503. */
export class UnavailablePlatformAuditStore implements PlatformAuditStore {
  list(): never {
    throw new BackofficeUnavailableError();
  }
}
