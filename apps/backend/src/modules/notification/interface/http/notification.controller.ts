import { Controller, Inject } from '@nestjs/common';

import { NOTIFICATION_FACADE, type NotificationFacade } from '../../api/notification.facade.js';

/** Thin controller: Zod-validate (packages/contracts) → facade → DTO. */
@Controller('notification')
export class NotificationController {
  constructor(@Inject(NOTIFICATION_FACADE) private readonly facade: NotificationFacade) {}
}
