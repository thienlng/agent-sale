import type {
  ClaimedWebhookEvent,
  IntegrationStore,
  JobRecord,
} from '../../application/ports/integration-store.js';
import { MemoryIntegrationStore } from './memory-integration-store.js';

/** The memory store plus the system-role job methods, recording every fenced write. */
export class JobStore extends MemoryIntegrationStore {
  cursors: Array<Record<string, unknown>> = [];
  completed: string[] = [];
  retried: Array<{ id: string; runAfter: Date; error: string }> = [];
  failed: Array<{ id: string; error: string }> = [];
  leaseOk = true;
  events: ClaimedWebhookEvent[] = [];
  images = new Map<string, string>();

  override connectionForSystem = (id: string) =>
    Promise.resolve(structuredClone(this.connections.find((c) => c.id === id) ?? null));
  override saveCursor = (_id: string, _t: string, cursor: Record<string, unknown>) => {
    if (this.leaseOk) this.cursors.push(structuredClone(cursor));
    return Promise.resolve(this.leaseOk);
  };
  override completeJob = (id: string) => (this.completed.push(id), Promise.resolve(this.leaseOk));
  override retryJob = (id: string, _t: string, runAfter: Date, error: string) => {
    this.retried.push({ id, runAfter, error });
    return Promise.resolve(this.leaseOk);
  };
  override failJob = (id: string, _t: string, error: string) => {
    this.failed.push({ id, error });
    return Promise.resolve(this.leaseOk);
  };
  override claimJobs = () => Promise.resolve([] as JobRecord[]);
  override claimWebhookEvents = () => Promise.resolve(this.events.splice(0));
  override connectionsDueForReconcile: IntegrationStore['connectionsDueForReconcile'] = () =>
    Promise.resolve([]);
  override cachedImage = (_ws: string, url: string) =>
    Promise.resolve(this.images.get(url) ?? null);
  override cacheImage = (_ws: string, url: string, stored: string) => {
    this.images.set(url, stored);
    return Promise.resolve();
  };

  codes(): string[] {
    return this.logs.map((l) => l.code);
  }
}
