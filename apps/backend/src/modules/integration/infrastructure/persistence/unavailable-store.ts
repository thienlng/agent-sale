import type { IntegrationStore } from '../../application/ports/integration-store.js';
import { IntegrationUnavailableError } from '../../domain/integration.errors.js';

const unavailable = (): Promise<never> => Promise.reject(new IntegrationUnavailableError());

/**
 * Used when the process runs without a database (DB-less HTTP tests, quick UI runs): the sync relies
 * on leases and unique indexes an in-memory fake would not reproduce faithfully, so integration
 * routes answer 503 instead.
 */
export class UnavailableIntegrationStore implements IntegrationStore {
  liveConnection = unavailable;
  insertConnection = unavailable;
  updateConnection = unavailable;
  enqueue = unavailable;
  log = unavailable;
  recentLog = unavailable;
  cachedImage = unavailable;
  cacheImage = unavailable;
  claimJobs = unavailable;
  saveCursor = unavailable;
  completeJob = unavailable;
  retryJob = unavailable;
  failJob = unavailable;
  claimWebhookEvents = unavailable;
  connectionsDueForReconcile = unavailable;
  connectionForSystem = unavailable;
}
