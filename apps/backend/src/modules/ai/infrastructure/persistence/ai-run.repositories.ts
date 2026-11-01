import { and, desc, eq, gte, type Database, schema, withTenant } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type { AiRunRecord, AiRunRepository } from '../../domain/ports/ai-run.repository.js';

export class DrizzleAiRunRepository implements AiRunRepository {
  constructor(private readonly db: Database) {}

  async record(workspaceId: WorkspaceId, run: AiRunRecord): Promise<void> {
    await withTenant(this.db, workspaceId, (tx) =>
      tx.insert(schema.aiRuns).values({ ...run, workspaceId }),
    );
  }

  async recentProductIds(
    workspaceId: WorkspaceId,
    conversationId: string,
    opts: { runs: number; limit: number; since?: Date },
  ): Promise<string[]> {
    const rows = await withTenant(this.db, workspaceId, (tx) =>
      tx
        .select({ productIds: schema.aiRuns.productIds })
        .from(schema.aiRuns)
        .where(
          and(
            eq(schema.aiRuns.workspaceId, workspaceId),
            eq(schema.aiRuns.conversationId, conversationId),
            opts.since ? gte(schema.aiRuns.createdAt, opts.since) : undefined,
          ),
        )
        .orderBy(desc(schema.aiRuns.createdAt))
        .limit(opts.runs),
    );
    return dedupe(
      rows.flatMap((r) => r.productIds),
      opts.limit,
    );
  }
}

function dedupe(ids: string[], limit: number): string[] {
  return [...new Set(ids)].slice(0, limit);
}

export class InMemoryAiRunRepository implements AiRunRepository {
  readonly runs: Array<AiRunRecord & { workspaceId: WorkspaceId }> = [];

  async record(workspaceId: WorkspaceId, run: AiRunRecord): Promise<void> {
    this.runs.push({ ...run, workspaceId });
  }

  async recentProductIds(
    workspaceId: WorkspaceId,
    conversationId: string,
    opts: { runs: number; limit: number; since?: Date },
  ): Promise<string[]> {
    const since = opts.since?.getTime();
    const recent = this.runs
      .filter(
        (r) =>
          r.workspaceId === workspaceId &&
          r.conversationId === conversationId &&
          (since === undefined || r.createdAt.getTime() >= since),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, opts.runs);
    return dedupe(
      recent.flatMap((r) => r.productIds),
      opts.limit,
    );
  }
}
