import type { WorkspaceId } from '@agent-sales/shared';

import type { FaqRepository } from '../../domain/ports/faq.repository.js';

export interface KnowledgeTxContext {
  faqs: FaqRepository;
}

/** One withTenant transaction per `run` (pattern from the workspace golden module). */
export interface KnowledgeUnitOfWork {
  run<T>(workspaceId: WorkspaceId, fn: (ctx: KnowledgeTxContext) => Promise<T>): Promise<T>;
}

export const KNOWLEDGE_UOW = Symbol('KNOWLEDGE_UOW');
