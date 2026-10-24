import type { WorkspaceId } from '@agent-sales/shared';

/** Read model other modules receive; no domain objects cross the boundary. */
export interface FaqView {
  id: string;
  botId: string;
  question: string;
  answer: string;
  source: 'seed' | 'manual' | 'import';
  updatedAt: Date;
}

export interface FaqHit extends FaqView {
  score: number;
}

/**
 * PUBLIC CONTRACT of the knowledge module. Callers (bot, ai) are responsible
 * for checking that `botId` belongs to the workspace before calling.
 */
export interface KnowledgeFacade {
  importFaqs(
    workspaceId: WorkspaceId,
    botId: string,
    items: Array<{ question: string; answer: string }>,
  ): Promise<FaqView[]>;
  listFaqs(workspaceId: WorkspaceId, botId: string): Promise<FaqView[]>;
  createFaq(
    workspaceId: WorkspaceId,
    botId: string,
    input: { question: string; answer: string },
  ): Promise<FaqView>;
  updateFaq(
    workspaceId: WorkspaceId,
    botId: string,
    faqId: string,
    change: { question?: string | undefined; answer?: string | undefined },
  ): Promise<FaqView>;
  deleteFaq(workspaceId: WorkspaceId, botId: string, faqId: string): Promise<void>;
  /** Bulk insert used by industry seed packs. */
  seedFaqs(
    workspaceId: WorkspaceId,
    botId: string,
    items: Array<{ question: string; answer: string }>,
  ): Promise<number>;
  /** Most relevant FAQs for a customer message (Vietnamese-aware, accent-insensitive). */
  searchFaqs(
    workspaceId: WorkspaceId,
    botId: string,
    query: string,
    limit?: number,
  ): Promise<FaqHit[]>;
}

export const KNOWLEDGE_FACADE = Symbol('KNOWLEDGE_FACADE');
