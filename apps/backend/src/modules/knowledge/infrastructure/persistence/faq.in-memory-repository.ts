import type { Faq } from '../../domain/faq.js';
import type { FaqMatch, FaqRepository } from '../../domain/ports/faq.repository.js';

/** Character-trigram set of a folded string, padded like pg_trgm. */
function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const word of s.split(/[^a-z0-9]+/).filter(Boolean)) {
    const w = `  ${word} `;
    for (let i = 0; i < w.length - 2; i++) out.add(w.slice(i, i + 3));
  }
  return out;
}

/** Share of the query's trigrams found in the text (approximates pg_trgm word_similarity). */
export function overlapScore(foldedQuery: string, foldedText: string): number {
  const q = trigrams(foldedQuery);
  if (q.size === 0) return 0;
  const tx = trigrams(foldedText);
  let hit = 0;
  for (const g of q) if (tx.has(g)) hit++;
  return hit / q.size;
}

/** DB-less adapter for unit tests and quick local runs; not workspace-isolated. */
export class InMemoryFaqRepository implements FaqRepository {
  readonly rows = new Map<string, Faq>();

  async listByBot(botId: string): Promise<Faq[]> {
    return [...this.rows.values()].filter((f) => f.snapshot().botId === botId);
  }

  async findById(botId: string, id: string): Promise<Faq | null> {
    const f = this.rows.get(id);
    return f && f.snapshot().botId === botId ? f : null;
  }

  async save(faq: Faq): Promise<void> {
    this.rows.set(faq.id, faq);
  }

  async saveMany(faqs: Faq[]): Promise<void> {
    for (const f of faqs) this.rows.set(f.id, f);
  }

  async delete(botId: string, id: string): Promise<boolean> {
    if (!(await this.findById(botId, id))) return false;
    return this.rows.delete(id);
  }

  async search(botId: string, foldedQuery: string, limit: number): Promise<FaqMatch[]> {
    return (await this.listByBot(botId))
      .map((faq) => ({ faq, score: overlapScore(foldedQuery, faq.searchText()) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
