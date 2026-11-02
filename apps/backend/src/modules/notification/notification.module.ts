import { Module } from '@nestjs/common';

import { NOTIFICATION_FACADE } from './api/notification.facade.js';
import { NotificationFacadeImpl } from './application/notification.facade.impl.js';
import { NotificationController } from './interface/http/notification.controller.js';

/** Bind ports to adapters here. Export ONLY what api/ declares. */
@Module({
  controllers: [NotificationController],
  providers: [{ provide: NOTIFICATION_FACADE, useClass: NotificationFacadeImpl }],
  exports: [NOTIFICATION_FACADE],
})
export class NotificationModule {}
