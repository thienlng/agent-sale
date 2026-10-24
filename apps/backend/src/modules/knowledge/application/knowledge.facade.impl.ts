import { foldVietnamese, isUuid, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { FaqHit, FaqView, KnowledgeFacade } from '../api/knowledge.facade.js';
import { Faq } from '../domain/faq.js';
import { FaqNotFoundError } from '../domain/knowledge.errors.js';
import { KNOWLEDGE_UOW, type KnowledgeUnitOfWork } from './ports/knowledge-unit-of-work.js';

/** Minimum relevance for a FAQ to be offered to the AI as a source. */
export const MIN_SCORE = 0.15;

function view(faq: Faq): FaqView {
  const s = faq.snapshot();
  return {
    id: s.id,
    botId: s.botId,
    question: s.question,
    answer: s.answer,
    source: s.source,
    updatedAt: s.updatedAt,
  };
}

/**
 * Handlers are small enough to live in the facade for now; split into
 * commands/queries when any of them grows rules of its own.
 */
@Injectable()
export class KnowledgeFacadeImpl implements KnowledgeFacade {
  constructor(@Inject(KNOWLEDGE_UOW) private readonly uow: KnowledgeUnitOfWork) {}

  importFaqs(
    ws: WorkspaceId,
    botId: string,
    items: Array<{ question: string; answer: string }>,
  ): Promise<FaqView[]> {
    return this.uow.run(ws, async ({ faqs }) => {
      const created = items.map((item) =>
        Faq.create({ workspaceId: ws, botId, ...item, source: 'import' }),
      );
      await faqs.saveMany(created);
      return created.map(view);
    });
  }

  listFaqs(ws: WorkspaceId, botId: string): Promise<FaqView[]> {
    return this.uow.run(ws, async ({ faqs }) => (await faqs.listByBot(botId)).map(view));
  }

  createFaq(
    ws: WorkspaceId,
    botId: string,
    input: { question: string; answer: string },
  ): Promise<FaqView> {
    return this.uow.run(ws, async ({ faqs }) => {
      const faq = Faq.create({ workspaceId: ws, botId, ...input, source: 'manual' });
      await faqs.save(faq);
      return view(faq);
    });
  }

  updateFaq(
    ws: WorkspaceId,
    botId: string,
    faqId: string,
    change: { question?: string | undefined; answer?: string | undefined },
  ): Promise<FaqView> {
    if (!isUuid(faqId)) return Promise.reject(new FaqNotFoundError(faqId));
    return this.uow.run(ws, async ({ faqs }) => {
      const faq = await faqs.findById(botId, faqId);
      if (!faq) throw new FaqNotFoundError(faqId);
      faq.edit(change);
      await faqs.save(faq);
      return view(faq);
    });
  }

  deleteFaq(ws: WorkspaceId, botId: string, faqId: string): Promise<void> {
    if (!isUuid(faqId)) return Promise.reject(new FaqNotFoundError(faqId));
    return this.uow.run(ws, async ({ faqs }) => {
      if (!(await faqs.delete(botId, faqId))) throw new FaqNotFoundError(faqId);
    });
  }

  seedFaqs(
    ws: WorkspaceId,
    botId: string,
    items: Array<{ question: string; answer: string }>,
  ): Promise<number> {
    return this.uow.run(ws, async ({ faqs }) => {
      const created = items.map((i) =>
        Faq.create({ workspaceId: ws, botId, ...i, source: 'seed' }),
      );
      await faqs.saveMany(created);
      return created.length;
    });
  }

  searchFaqs(ws: WorkspaceId, botId: string, query: string, limit = 5): Promise<FaqHit[]> {
    const folded = foldVietnamese(query);
    if (folded.length < 2) return Promise.resolve([]);
    return this.uow.run(ws, async ({ faqs }) =>
      (await faqs.search(botId, folded, limit))
        .filter((m) => m.score >= MIN_SCORE)
        .map((m) => ({ ...view(m.faq), score: m.score })),
    );
  }
}
