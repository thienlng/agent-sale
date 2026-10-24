import type { CommerceStore } from '../../application/ports/commerce-store.js';
import { CommerceUnavailableError } from '../../domain/commerce.errors.js';

/**
 * Used when the process runs without a database (DB-less HTTP tests, quick UI
 * runs): commerce relies on SQL search and aggregates that an in-memory fake
 * would not reproduce faithfully, so its routes answer 503 instead.
 */
export class UnavailableCommerceStore implements CommerceStore {
  run<T>(): Promise<T> {
    return Promise.reject(new CommerceUnavailableError());
  }
}
