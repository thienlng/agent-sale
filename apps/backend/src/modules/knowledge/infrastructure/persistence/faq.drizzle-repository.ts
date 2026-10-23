import { and, desc, eq, schema, sql, type TenantTx } from '@agent-sales/db';
import { workspaceId } from '@agent-sales/shared';

import { Faq, type FaqSource } from '../../domain/faq.js';
import type { FaqMatch, FaqRepository } from '../../domain/ports/faq.repository.js';

type Row = typeof schema.knowledgeItems.$inferSelect;
const t = schema.knowledgeItems;

function toFaq(r: Row): Faq {
  return Faq.rehydrate({
    id: r.id,
    workspaceId: workspaceId(r.workspaceId),
    botId: r.botId,
    question: r.question,
    answer: r.answer,
    source: r.source as FaqSource,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });
}

function toRow(f: Faq) {
  const s = f.snapshot();
  return {
    id: s.id,
    workspaceId: s.workspaceId,
    botId: s.botId,
    type: 'faq',
    question: s.question,
    answer: s.answer,
    searchText: f.searchText(),
    source: s.source,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/** Bound to one withTenant transaction; RLS scopes every statement to the workspace. */
export class DrizzleFaqRepository implements FaqRepository {
  constructor(private readonly tx: TenantTx) {}

  async listByBot(botId: string): Promise<Faq[]> {
    const rows = await this.tx.select().from(t).where(eq(t.botId, botId)).orderBy(t.createdAt);
    return rows.map(toFaq);
  }

  async findById(botId: string, id: string): Promise<Faq | null> {
    const [r] = await this.tx
      .select()
      .from(t)
      .where(and(eq(t.botId, botId), eq(t.id, id)))
      .limit(1);
    return r ? toFaq(r) : null;
  }

  async save(faq: Faq): Promise<void> {
    const row = toRow(faq);
    await this.tx
      .insert(t)
      .values(row)
      .onConflictDoUpdate({
        target: t.id,
        set: {
          question: row.question,
          answer: row.answer,
          searchText: row.searchText,
          updatedAt: row.updatedAt,
        },
      });
  }

  async saveMany(faqs: Faq[]): Promise<void> {
    if (faqs.length) await this.tx.insert(t).values(faqs.map(toRow));
  }

  async delete(botId: string, id: string): Promise<boolean> {
    const rows = await this.tx
      .delete(t)
      .where(and(eq(t.botId, botId), eq(t.id, id)))
      .returning({ id: t.id });
    return rows.length === 1;
  }

  /**
   * pg_trgm: word_similarity rewards a query that appears inside a longer FAQ,
   * similarity rewards near-identical wording; take the better of the two.
   */
  async search(botId: string, foldedQuery: string, limit: number): Promise<FaqMatch[]> {
    const score = sql<number>`greatest(word_similarity(${foldedQuery}, ${t.searchText}), similarity(${t.searchText}, ${foldedQuery}))`;
    const rows = await this.tx
      .select({ row: t, score })
      .from(t)
      .where(eq(t.botId, botId))
      .orderBy(desc(score))
      .limit(limit);
    return rows.map((r) => ({ faq: toFaq(r.row), score: Number(r.score) }));
  }
}
