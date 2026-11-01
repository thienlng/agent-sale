import type {
  ClaimedWebhookEvent,
  IntegrationStore,
  JobRecord,
} from '../../application/ports/integration-store.js';
import { type MemoryJob, MemoryIntegrationStore } from './memory-integration-store.js';

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
  override saveCursor = (id: string, _t: string, cursor: Record<string, unknown>) => {
    if (this.leaseOk) {
      this.cursors.push(structuredClone(cursor));
      this.queued(id, (j) => (j.cursor = structuredClone(cursor)));
    }
    return Promise.resolve(this.leaseOk);
  };
  override completeJob = (id: string) => {
    this.completed.push(id);
    if (this.leaseOk) this.queued(id, (j) => (j.open = false));
    return Promise.resolve(this.leaseOk);
  };
  override retryJob = (id: string, _t: string, runAfter: Date, error: string) => {
    this.retried.push({ id, runAfter, error });
    return Promise.resolve(this.leaseOk);
  };
  override failJob = (id: string, _t: string, error: string) => {
    this.failed.push({ id, error });
    if (this.leaseOk) this.queued(id, (j) => (j.open = false));
    return Promise.resolve(this.leaseOk);
  };

  /** A queued job as the runner claims it. */
  claimed(id: string, over: Partial<JobRecord> = {}): JobRecord {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) throw new Error(`no queued job ${id}`);
    return {
      id: j.id,
      workspaceId: j.workspaceId,
      connectionId: j.connectionId,
      kind: j.kind,
      payload: structuredClone(j.payload),
      cursor: j.cursor ? structuredClone(j.cursor) : null,
      attempts: 0,
      claimToken: `claim-${j.id}`,
      ...over,
    };
  }

  /** Mirrors fenced writes on the queued job (jobs built by hand are not in `jobs`). */
  private queued(id: string, apply: (j: MemoryJob) => void): void {
    const j = this.jobs.find((x) => x.id === id);
    if (j) apply(j);
  }
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
