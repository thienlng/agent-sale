import { type Database, schema, withTenant } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type { AiRunRecord, AiRunRepository } from '../../domain/ports/ai-run.repository.js';

export class DrizzleAiRunRepository implements AiRunRepository {
  constructor(private readonly db: Database) {}

  async record(workspaceId: WorkspaceId, run: AiRunRecord): Promise<void> {
    await withTenant(this.db, workspaceId, (tx) =>
      tx.insert(schema.aiRuns).values({ ...run, workspaceId }),
    );
  }
}

export class InMemoryAiRunRepository implements AiRunRepository {
  readonly runs: Array<AiRunRecord & { workspaceId: WorkspaceId }> = [];

  async record(workspaceId: WorkspaceId, run: AiRunRecord): Promise<void> {
    this.runs.push({ ...run, workspaceId });
  }
}
