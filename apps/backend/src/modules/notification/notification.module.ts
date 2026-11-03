import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { getEnv } from '../../common/config.js';
import { DB_SYSTEM, DB_TENANT } from '../../common/db/db.module.js';
import { ResendMailer } from '../../common/email/mailer.js';
import { IdentityModule } from '../identity/identity.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { NOTIFICATION_FACADE } from './api/notification.facade.js';
import { NOTIFICATION_RUNNER } from './api/notification.runner.js';
import { DeliveryRunner, NOTIFICATION_APP_URL } from './application/delivery-runner.js';
import { NotificationFacadeImpl } from './application/notification.facade.impl.js';
import { NotificationService } from './application/notification.service.js';
import {
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
} from './domain/ports/notification-channel.port.js';
import { NOTIFICATION_REPOSITORY } from './domain/ports/notification.repository.js';
import { MailerEmailChannel } from './infrastructure/clients/email.channel.js';
import { DrizzleNotificationRepository } from './infrastructure/persistence/notification.drizzle-repository.js';
import { InMemoryNotificationRepository } from './infrastructure/persistence/notification.in-memory-repository.js';
import { NotificationController } from './interface/http/notification.controller.js';

/**
 * Tier-0 notifications (T-172, S3-R5): in-app rows, and email deliveries through Resend sent by the
 * worker's `NOTIFICATION_RUNNER`. Push has no adapter yet: its deliveries are skipped
 * (`channel_unavailable`). Exports ONLY what api/ declares.
 */
@Module({
  imports: [IdentityModule, WorkspaceModule],
  controllers: [NotificationController],
  providers: [
    {
      provide: NOTIFICATION_REPOSITORY,
      inject: [
        { token: DB_TENANT, optional: true },
        { token: DB_SYSTEM, optional: true },
      ],
      useFactory: (db: Database | null | undefined, system: Database | null | undefined) =>
        db
          ? new DrizzleNotificationRepository(db, system ?? null)
          : new InMemoryNotificationRepository(),
    },
    {
      provide: NOTIFICATION_CHANNELS,
      useFactory: (): NotificationChannel[] => {
        const env = getEnv();
        return [
          new MailerEmailChannel(
            env.RESEND_API_KEY ? new ResendMailer(env.RESEND_API_KEY, env.EMAIL_FROM) : null,
          ),
        ];
      },
    },
    { provide: NOTIFICATION_APP_URL, useFactory: () => getEnv().APP_PUBLIC_URL ?? null },
    NotificationService,
    DeliveryRunner,
    { provide: NOTIFICATION_FACADE, useClass: NotificationFacadeImpl },
    { provide: NOTIFICATION_RUNNER, useExisting: DeliveryRunner },
  ],
  exports: [NOTIFICATION_FACADE, NOTIFICATION_RUNNER],
})
export class NotificationModule {}
