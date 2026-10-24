import type { CrmStore } from '../../application/ports/crm-store.js';
import { CrmUnavailableError } from '../../domain/crm.errors.js';

/** Without a database every CRM route answers 503 (the SQL filters have no faithful fake). */
export class UnavailableCrmStore implements CrmStore {
  run<T>(): Promise<T> {
    return Promise.reject(new CrmUnavailableError());
  }
}
