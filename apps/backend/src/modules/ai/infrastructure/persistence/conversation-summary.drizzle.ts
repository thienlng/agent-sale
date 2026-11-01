import { and, eq, type Database, schema, withTenant } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
  ConversationSummaryRepository,
  ConversationSummaryValue,
} from '../../domain/ports/conversation-summary.repository.js';

export class DrizzleConversationSummaryRepository implements ConversationSummaryRepository {
  constructor(private readonly db: Database) {}

  async get(ws: WorkspaceId, conversationId: string): Promise<ConversationSummaryValue | null> {
    const rows = await withTenant(this.db, ws, (tx) =>
      tx
        .select({
          coveredUntil: schema.conversationSummaries.coveredUntil,
          summary: schema.conversationSummaries.summary,
        })
        .from(schema.conversationSummaries)
        .where(
          and(
            eq(schema.conversationSummaries.workspaceId, ws),
            eq(schema.conversationSummaries.conversationId, conversationId),
          ),
        )
        .limit(1),
    );
    return rows[0] ?? null;
  }

  async put(
    ws: WorkspaceId,
    conversationId: string,
    value: ConversationSummaryValue,
  ): Promise<void> {
    await withTenant(this.db, ws, (tx) =>
      tx
        .insert(schema.conversationSummaries)
        .values({ workspaceId: ws, conversationId, ...value })
        .onConflictDoUpdate({
          target: [
            schema.conversationSummaries.workspaceId,
            schema.conversationSummaries.conversationId,
          ],
          set: { coveredUntil: value.coveredUntil, summary: value.summary, updatedAt: new Date() },
        }),
    );
  }
}

export class InMemoryConversationSummaryRepository implements ConversationSummaryRepository {
  private readonly rows = new Map<string, ConversationSummaryValue>();

  async get(ws: WorkspaceId, conversationId: string): Promise<ConversationSummaryValue | null> {
    return this.rows.get(`${ws}:${conversationId}`) ?? null;
  }

  async put(
    ws: WorkspaceId,
    conversationId: string,
    value: ConversationSummaryValue,
  ): Promise<void> {
    this.rows.set(`${ws}:${conversationId}`, { ...value });
  }
}
