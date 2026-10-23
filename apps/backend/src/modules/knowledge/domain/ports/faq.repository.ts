import type { Faq } from '../faq.js';

export interface FaqMatch {
  faq: Faq;
  /** 0..1, higher is more relevant. */
  score: number;
}

/** Bound to one tenant transaction by the unit of work. */
export interface FaqRepository {
  listByBot(botId: string): Promise<Faq[]>;
  findById(botId: string, id: string): Promise<Faq | null>;
  save(faq: Faq): Promise<void>;
  saveMany(faqs: Faq[]): Promise<void>;
  delete(botId: string, id: string): Promise<boolean>;
  /** Relevance search over folded question+answer text (`foldedQuery` is already folded). */
  search(botId: string, foldedQuery: string, limit: number): Promise<FaqMatch[]>;
}
