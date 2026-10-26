import type { WorkspaceId } from '@agent-sales/shared';

import type {
  ActionRecord,
  ActionRepository,
  ActionRunRecord,
  ActionUnitOfWork,
  PendingRecord,
} from '../../application/ports/action-unit-of-work.js';

/** DB-less adapter for unit tests and quick local runs; rows are kept per workspace. */
export class InMemoryActionUnitOfWork implements ActionUnitOfWork {
  private readonly byWorkspace = new Map<string, Map<string, ActionRecord>>();
  private readonly pending = new Map<string, Map<string, PendingRecord>>();
  /** Recorded runs per workspace; exposed for tests. */
  readonly runs = new Map<string, ActionRunRecord[]>();

  run<T>(ws: WorkspaceId, fn: (repository: ActionRepository) => Promise<T>): Promise<T> {
    let rows = this.byWorkspace.get(ws);
    if (!rows) this.byWorkspace.set(ws, (rows = new Map()));
    const pending = this.pending.get(ws) ?? new Map<string, PendingRecord>();
    this.pending.set(ws, pending);
    const runs = this.runs.get(ws) ?? [];
    this.runs.set(ws, runs);
    return fn(new InMemoryActionRepository(rows, pending, runs));
  }
}

class InMemoryActionRepository implements ActionRepository {
  constructor(
    private readonly rows: Map<string, ActionRecord>,
    private readonly pending: Map<string, PendingRecord>,
    private readonly runs: ActionRunRecord[],
  ) {}
  async list(botId: string): Promise<ActionRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.botId === botId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async find(botId: string, id: string): Promise<ActionRecord | null> {
    const r = this.rows.get(id);
    return r && r.botId === botId ? structuredClone(r) : null;
  }
  async save(record: ActionRecord): Promise<void> {
    this.rows.set(record.id, structuredClone(record));
  }
  async delete(botId: string, id: string): Promise<boolean> {
    return (await this.find(botId, id)) ? this.rows.delete(id) : false;
  }
  async exists(id: string): Promise<boolean> {
    return this.rows.has(id);
  }
  async recordRun(run: ActionRunRecord): Promise<void> {
    this.runs.push(structuredClone(run));
  }
  async findPending(conversationId: string, now: Date): Promise<PendingRecord | null> {
    const p = this.pending.get(conversationId);
    return p && p.expiresAt > now ? structuredClone(p) : null;
  }
  async savePending(conversationId: string, pending: PendingRecord): Promise<void> {
    this.pending.set(conversationId, structuredClone(pending));
  }
  async clearPending(conversationId: string): Promise<void> {
    this.pending.delete(conversationId);
  }
  async consumePending(conversationId: string, now: Date): Promise<PendingRecord | null> {
    // No await between read and delete: single winner under concurrency.
    const p = this.pending.get(conversationId);
    this.pending.delete(conversationId);
    return p && p.expiresAt > now ? structuredClone(p) : null;
  }
}
