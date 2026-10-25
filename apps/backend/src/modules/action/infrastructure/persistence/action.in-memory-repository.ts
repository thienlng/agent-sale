import type { WorkspaceId } from '@agent-sales/shared';

import type {
  ActionRecord,
  ActionRepository,
  ActionUnitOfWork,
} from '../../application/ports/action-unit-of-work.js';

/** DB-less adapter for unit tests and quick local runs; rows are kept per workspace. */
export class InMemoryActionUnitOfWork implements ActionUnitOfWork {
  private readonly byWorkspace = new Map<string, Map<string, ActionRecord>>();

  run<T>(ws: WorkspaceId, fn: (repository: ActionRepository) => Promise<T>): Promise<T> {
    let rows = this.byWorkspace.get(ws);
    if (!rows) this.byWorkspace.set(ws, (rows = new Map()));
    return fn(new InMemoryActionRepository(rows));
  }
}

class InMemoryActionRepository implements ActionRepository {
  constructor(private readonly rows: Map<string, ActionRecord>) {}
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
}
