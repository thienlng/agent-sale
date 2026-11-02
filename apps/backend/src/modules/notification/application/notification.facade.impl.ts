import { Inject, Injectable } from '@nestjs/common';

import type {
  DeliveryStatus,
  NotificationChannelKind,
  NotificationFacade,
  NotifyInput,
} from '../api/notification.facade.js';
import { NotificationService } from './notification.service.js';

/** Delegates to the notification service; no logic of its own. */
@Injectable()
export class NotificationFacadeImpl implements NotificationFacade {
  constructor(@Inject(NotificationService) private readonly service: NotificationService) {}

  notify(i: NotifyInput): Promise<{ id: string; deduped: boolean }> {
    return this.service.notify(i);
  }

  recipientLocale(userId: string): Promise<'vi' | 'en'> {
    return this.service.recipientLocale(userId);
  }

  emailAvailable(): boolean {
    return this.service.emailAvailable();
  }

  deliverySummary(
    accountId: string,
    userId: string,
    ids: string[],
  ): Promise<Map<string, Partial<Record<NotificationChannelKind, DeliveryStatus>>>> {
    return this.service.deliverySummary(accountId, userId, ids);
  }
}
