import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_TENANT } from '../../common/db/db.module.js';
import { KNOWLEDGE_FACADE } from './api/knowledge.facade.js';
import { KnowledgeFacadeImpl } from './application/knowledge.facade.impl.js';
import { KNOWLEDGE_UOW } from './application/ports/knowledge-unit-of-work.js';
import {
  DrizzleKnowledgeUnitOfWork,
  InMemoryKnowledgeUnitOfWork,
} from './infrastructure/knowledge.unit-of-work.js';

/** FAQ knowledge. No HTTP of its own: the bot module exposes /bots/{botId}/faqs. */
@Module({
  providers: [
    {
      provide: KNOWLEDGE_UOW,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleKnowledgeUnitOfWork(db) : new InMemoryKnowledgeUnitOfWork(),
    },
    { provide: KNOWLEDGE_FACADE, useClass: KnowledgeFacadeImpl },
  ],
  exports: [KNOWLEDGE_FACADE],
})
export class KnowledgeModule {}
