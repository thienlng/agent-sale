import { type Database, withTenant } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
  KnowledgeTxContext,
  KnowledgeUnitOfWork,
} from '../application/ports/knowledge-unit-of-work.js';
import { DrizzleFaqRepository } from './persistence/faq.drizzle-repository.js';
import { InMemoryFaqRepository } from './persistence/faq.in-memory-repository.js';

export class DrizzleKnowledgeUnitOfWork implements KnowledgeUnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(workspaceId: WorkspaceId, fn: (ctx: KnowledgeTxContext) => Promise<T>): Promise<T> {
    return withTenant(this.db, workspaceId, (tx) => fn({ faqs: new DrizzleFaqRepository(tx) }));
  }
}

export class InMemoryKnowledgeUnitOfWork implements KnowledgeUnitOfWork {
  readonly faqs = new InMemoryFaqRepository();

  run<T>(_workspaceId: WorkspaceId, fn: (ctx: KnowledgeTxContext) => Promise<T>): Promise<T> {
    return fn({ faqs: this.faqs });
  }
}
