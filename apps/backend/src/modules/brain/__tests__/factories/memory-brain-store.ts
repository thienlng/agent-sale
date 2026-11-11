import type { WorkspaceId } from '@agent-sales/shared';

import type {
  BrainStore,
  MessageEventLease,
  MessageEventRow,
  MessageEventSource,
  SignalJob,
  SignalRunRecord,
} from '../../domain/ports/brain.store.js';
import { type BrainSettings, nextRunAfter } from '../../domain/schedule.js';
import type { ConversationSignal } from '../../domain/signal.js';

interface MemoryJob extends SignalJob {
  status: 'pending' | 'capped';
  leaseUntil: Date | null;
}

const key = (ws: string, id: string) => `${ws}/${id}`;

/** In-memory `BrainStore` with the same rules as the Drizzle one (tests only). */
export class MemoryBrainStore implements BrainStore {
  settings = new Map<string, BrainSettings>();
  signals = new Map<string, ConversationSignal>();
  jobs = new Map<string, MemoryJob>();
  usage = new Map<string, number>();
  runs: (SignalRunRecord & { workspaceId: string })[] = [];

  getSettings(ws: WorkspaceId) {
    return Promise.resolve(this.settings.get(ws) ?? null);
  }
  putSettings(ws: WorkspaceId, s: BrainSettings) {
    this.settings.set(ws, { ...s });
    return Promise.resolve();
  }
  getSignal(ws: WorkspaceId, id: string) {
    return Promise.resolve(this.signals.get(key(ws, id)) ?? null);
  }
  signalsFor(ws: WorkspaceId, ids: readonly string[]) {
    return Promise.resolve(
      ids.flatMap((id) => {
        const s = this.signals.get(key(ws, id));
        return s ? [s] : [];
      }),
    );
  }
  saveSignal(ws: WorkspaceId, s: ConversationSignal) {
    this.signals.set(key(ws, s.conversationId), { ...s });
    return Promise.resolve();
  }
  scheduleJob(ws: WorkspaceId, id: string, due: Date) {
    const existing = this.jobs.get(key(ws, id));
    this.jobs.set(key(ws, id), {
      workspaceId: ws,
      conversationId: id,
      trigger: 'idle',
      runAfter: nextRunAfter(existing?.runAfter ?? null, due, 0),
      attempts: 0,
      status: 'pending',
      leaseUntil: existing?.leaseUntil ?? null,
    });
    return Promise.resolve();
  }
  claimDueJobs(now: Date, limit: number, leaseMs: number) {
    const due = [...this.jobs.values()]
      .filter(
        (j) =>
          j.status === 'pending' &&
          j.runAfter <= now &&
          (j.leaseUntil === null || j.leaseUntil < now),
      )
      .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime())
      .slice(0, limit);
    for (const j of due) {
      j.leaseUntil = new Date(now.getTime() + leaseMs);
      j.attempts += 1;
    }
    return Promise.resolve(due.map((j) => ({ ...j })));
  }
  finishJob(ws: WorkspaceId, id: string, claimedRunAfter: Date) {
    const j = this.jobs.get(key(ws, id));
    if (j && j.runAfter <= claimedRunAfter) this.jobs.delete(key(ws, id));
    else if (j) j.leaseUntil = null;
    return Promise.resolve();
  }
  capJob(ws: WorkspaceId, id: string, until: Date) {
    const j = this.jobs.get(key(ws, id));
    if (j) Object.assign(j, { status: 'capped', runAfter: until, leaseUntil: null });
    return Promise.resolve();
  }
  retryJob(ws: WorkspaceId, id: string, retryAt: Date) {
    const j = this.jobs.get(key(ws, id));
    if (j) {
      j.runAfter = new Date(Math.max(j.runAfter.getTime(), retryAt.getTime()));
      j.leaseUntil = null;
    }
    return Promise.resolve();
  }
  resetCappedJobs(now: Date) {
    let n = 0;
    for (const j of this.jobs.values()) {
      if (j.status === 'capped' && j.runAfter <= now) {
        j.status = 'pending';
        n++;
      }
    }
    return Promise.resolve(n);
  }
  reserveUsage(ws: WorkspaceId, day: string, limit: number | null) {
    const used = this.usage.get(key(ws, day)) ?? 0;
    if (limit !== null && used >= limit) return Promise.resolve(false);
    this.usage.set(key(ws, day), used + 1);
    return Promise.resolve(true);
  }
  releaseUsage(ws: WorkspaceId, day: string) {
    this.usage.set(key(ws, day), Math.max(0, (this.usage.get(key(ws, day)) ?? 0) - 1));
    return Promise.resolve();
  }
  usedOn(ws: WorkspaceId, day: string) {
    return Promise.resolve(this.usage.get(key(ws, day)) ?? 0);
  }
  recordRun(ws: WorkspaceId, run: SignalRunRecord) {
    this.runs.push({ workspaceId: ws, ...run });
    return Promise.resolve();
  }
}

/** In-memory outbox window: `push` events, then a pass reads and commits them. */
export class MemoryMessageEvents implements MessageEventSource {
  #pending: MessageEventRow[] = [];
  #nextId = 1;

  push(row: Omit<MessageEventRow, 'id'>): void {
    this.#pending.push({ id: this.#nextId++, ...row });
  }

  async withLease<T>(fn: (lease: MessageEventLease) => Promise<T>): Promise<T | null> {
    const window = [...this.#pending];
    return fn({
      readBatch: (afterId, limit) =>
        Promise.resolve(window.filter((r) => r.id > afterId).slice(0, limit)),
      commit: () => {
        this.#pending = this.#pending.filter((r) => !window.includes(r));
        return Promise.resolve();
      },
    });
  }
}
