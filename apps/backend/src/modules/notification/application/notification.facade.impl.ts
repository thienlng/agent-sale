import { Injectable } from '@nestjs/common';

import type { NotificationFacade } from '../api/notification.facade.js';

/** Filled in with the notification service (T-172, task 2). */
@Injectable()
export class NotificationFacadeImpl implements NotificationFacade {
  notify(): Promise<{ id: string; deduped: boolean }> {
    return Promise.reject(new Error('notification facade not wired yet'));
  }

  recipientLocale(): Promise<'vi' | 'en'> {
    return Promise.resolve('vi');
  }

  emailAvailable(): boolean {
    return false;
  }

  deliverySummary(): Promise<Map<string, Record<string, never>>> {
    return Promise.resolve(new Map());
  }
}
