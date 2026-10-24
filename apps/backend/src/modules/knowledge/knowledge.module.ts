import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';
import { getEnv } from '../../common/config.js';
import { MEDIA_FACADE } from './api/media.facade.js';
import { MediaFacadeImpl } from './application/media.facade.impl.js';
import { BOT_MEDIA_STORAGE } from './application/ports/bot-media-storage.js';
import { S3BotMediaStorage } from './infrastructure/s3-bot-media-storage.js';

import { TRAINING_FACADE } from './api/training.facade.js';
import { TrainingFacadeImpl } from './application/training.facade.impl.js';
import { TRAINING_UOW } from './application/ports/training-unit-of-work.js';
import {
  DrizzleTrainingUnitOfWork,
  InMemoryTrainingUnitOfWork,
} from './infrastructure/training.persistence.js';

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
      provide: BOT_MEDIA_STORAGE,
      useFactory: () => {
        const env = getEnv();
        return new S3BotMediaStorage({
          endpoint: env.S3_ENDPOINT,
          bucket: env.S3_BUCKET,
          publicUrl: env.S3_PUBLIC_URL,
          accessKey: env.S3_ACCESS_KEY,
          secretKey: env.S3_SECRET_KEY,
        });
      },
    },
    { provide: MEDIA_FACADE, useClass: MediaFacadeImpl },
    {
      provide: TRAINING_UOW,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleTrainingUnitOfWork(db) : new InMemoryTrainingUnitOfWork(),
    },
    { provide: TRAINING_FACADE, useClass: TrainingFacadeImpl },
    {
      provide: KNOWLEDGE_UOW,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleKnowledgeUnitOfWork(db) : new InMemoryKnowledgeUnitOfWork(),
    },
    { provide: KNOWLEDGE_FACADE, useClass: KnowledgeFacadeImpl },
  ],
  exports: [KNOWLEDGE_FACADE, TRAINING_FACADE, MEDIA_FACADE],
})
export class KnowledgeModule {}
