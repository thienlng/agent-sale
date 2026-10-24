import type { AuditStore } from '../../application/ports/audit-store.js';
import { AuditUnavailableError } from '../../domain/audit.errors.js';

/** Without a database, the audit trail answers 503. */
export class UnavailableAuditStore implements AuditStore {
  list(): never {
    throw new AuditUnavailableError();
  }
}
