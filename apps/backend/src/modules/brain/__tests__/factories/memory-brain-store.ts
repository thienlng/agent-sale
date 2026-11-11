import type { WorkspaceId } from '@agent-sales/shared';

import type {
  BrainStore,
  BriefingState,
  MessageEventLease,
  MessageEventRow,
  MessageEventSource,
  SignalJob,
  SignalRunRecord,
} from '../../domain/ports/brain.store.js';
import type { AutonomyAction, AutonomyLevel } from '../../domain/autonomy.js';
import { type BrainSettings, DEFAULT_BRAIN_SETTINGS, nextRunAfter } from '../../domain/schedule.js';
import { blankSignal, type ConversationSignal, type StageChange } from '../../domain/signal.js';

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
  /** `brain.signals.updated.v1` written with each evaluation or stage change. */
  updated: { workspaceId: string; conversationId: string; stage: string; optOut: boolean }[] = [];
  #updated(ws: WorkspaceId, s: ConversationSignal) {
    this.updated.push({
      workspaceId: ws,
      conversationId: s.conversationId,
      stage: s.stage,
      optOut: s.optOut,
    });
  }

  autonomy = new Map<string, AutonomyLevel>();
  getAutonomy(ws: WorkspaceId) {
    return Promise.resolve(
      [...this.autonomy]
        .filter(([k]) => k.startsWith(`${ws}/`))
        .map(([k, level]) => ({ action: k.slice(ws.length + 1) as AutonomyAction, level })),
    );
  }
  putAutonomy(ws: WorkspaceId, rows: readonly { action: AutonomyAction; level: AutonomyLevel }[]) {
    for (const r of rows) this.autonomy.set(key(ws, r.action), r.level);
    return Promise.resolve();
  }
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
  /** Test seeding: stores the row as given (not part of the port). */
  saveSignal(ws: WorkspaceId, s: ConversationSignal) {
    this.signals.set(key(ws, s.conversationId), { ...s });
    return Promise.resolve();
  }
  /** Same rules as the SQL upsert: member-owned columns come from the stored row. */
  saveEvaluation(ws: WorkspaceId, s: ConversationSignal, lastCustomerMessageAt: Date | null) {
    const stored = this.signals.get(key(ws, s.conversationId));
    if (!stored) {
      const row = { ...s, stageLocked: false, dismissedUntilMessageAfter: null, version: 1 };
      this.signals.set(key(ws, s.conversationId), row);
      this.#updated(ws, row);
      return Promise.resolve({ ...row });
    }
    const dismissed = stored.dismissedUntilMessageAfter;
    const row: ConversationSignal = {
      ...s,
      contactId: s.contactId ?? stored.contactId,
      evaluatedUntil:
        stored.evaluatedUntil && (!s.evaluatedUntil || stored.evaluatedUntil > s.evaluatedUntil)
          ? stored.evaluatedUntil
          : s.evaluatedUntil,
      stage: stored.stageLocked ? stored.stage : s.stage,
      stageLocked: stored.stageLocked,
      dismissedUntilMessageAfter:
        dismissed && lastCustomerMessageAt && lastCustomerMessageAt > dismissed ? null : dismissed,
      version: stored.version + 1,
    };
    this.signals.set(key(ws, s.conversationId), row);
    this.#updated(ws, row);
    return Promise.resolve({ ...row });
  }
  saveStage(ws: WorkspaceId, id: string, contactId: string | null, change: StageChange, now: Date) {
    const stored = this.signals.get(key(ws, id));
    const base = stored ?? { ...blankSignal(id, contactId, now), version: 0 };
    const row: ConversationSignal = {
      ...base,
      stage: change.stage ?? base.stage,
      stageLocked: change.stageLocked,
      version: base.version + 1,
      updatedAt: now,
    };
    this.signals.set(key(ws, id), row);
    this.#updated(ws, row);
    return Promise.resolve({ ...row });
  }
  dismissSignal(ws: WorkspaceId, id: string, contactId: string | null, at: Date) {
    const base = this.signals.get(key(ws, id)) ?? { ...blankSignal(id, contactId, at), version: 0 };
    this.signals.set(key(ws, id), {
      ...base,
      dismissedUntilMessageAfter: at,
      version: base.version + 1,
      updatedAt: at,
    });
    return Promise.resolve();
  }
  undismissSignal(ws: WorkspaceId, id: string, at: Date) {
    const base = this.signals.get(key(ws, id));
    if (base)
      this.signals.set(key(ws, id), {
        ...base,
        dismissedUntilMessageAfter: null,
        version: base.version + 1,
        updatedAt: at,
      });
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
    else if (j) Object.assign(j, { leaseUntil: null, attempts: 0 });
    return Promise.resolve();
  }
  capJob(ws: WorkspaceId, id: string, until: Date) {
    const j = this.jobs.get(key(ws, id));
    if (j) Object.assign(j, { status: 'capped', runAfter: until, leaseUntil: null, attempts: 0 });
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
  resetCappedJobs(now: Date, runAfter: Date) {
    let n = 0;
    for (const j of this.jobs.values()) {
      if (j.status === 'capped' && j.runAfter <= now) {
        j.status = 'pending';
        j.runAfter = runAfter;
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
  todaySignalRefs(
    ws: WorkspaceId,
    q: { now: Date; readySince: Date; priceSince: Date; limit: number },
  ) {
    return Promise.resolve(
      [...this.signals.entries()]
        .filter(([k]) => k.startsWith(`${ws}/`))
        .map(([, s]) => s)
        .filter(
          (s) =>
            s.mood === 'complaint' ||
            s.needsHuman ||
            (s.stage === 'ready' && (s.evaluatedAt ?? s.updatedAt) >= q.readySince) ||
            (s.stage === 'price_asked' &&
              (s.evaluatedUntil ?? s.evaluatedAt ?? s.updatedAt) >= q.priceSince) ||
            (s.followUpAt !== null && s.followUpAt <= q.now),
        )
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, q.limit)
        .map((s) => ({
          conversationId: s.conversationId,
          attention: s.mood === 'complaint' || s.needsHuman,
        })),
    );
  }
  pendingJobIds(ws: WorkspaceId, limit: number) {
    return Promise.resolve(
      [...this.jobs.values()]
        .filter((j) => j.workspaceId === ws)
        .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime())
        .slice(0, limit)
        .map((j) => j.conversationId),
    );
  }
  /** `last_briefing_day` per business (memory twin of the column). */
  briefingDays = new Map<string, string>();
  briefingStates(ids: readonly WorkspaceId[]) {
    return Promise.resolve(
      ids.flatMap((ws): BriefingState[] => {
        const s = this.settings.get(ws);
        const last = this.briefingDays.get(ws) ?? null;
        if (!s && last === null) return [];
        return [
          {
            workspaceId: ws,
            briefingEnabled: (s ?? DEFAULT_BRAIN_SETTINGS).briefingEnabled,
            briefingHour: (s ?? DEFAULT_BRAIN_SETTINGS).briefingHour,
            lastBriefingDay: last,
          },
        ];
      }),
    );
  }
  claimBriefing(ws: WorkspaceId, day: string) {
    const last = this.briefingDays.get(ws);
    if (last !== undefined && last >= day) return Promise.resolve(false);
    this.briefingDays.set(ws, day);
    return Promise.resolve(true);
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
