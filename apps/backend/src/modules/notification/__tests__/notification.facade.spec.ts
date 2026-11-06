import { newId } from '@agent-sales/shared';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { NOTIFICATION_FACADE, NOTIFICATION_RUNNER, type NotificationFacade } from '../api/index.js';
import { NotificationModule } from '../notification.module.js';

/** Contract test: the public API behaves as MODULE.md promises. */
describe('NotificationFacade (contract)', () => {
  it('is provided by the module, with the runner', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [NotificationModule] }).compile();
    expect(moduleRef.get(NOTIFICATION_FACADE)).toBeDefined();
    expect(moduleRef.get(NOTIFICATION_RUNNER)).toBeDefined();
  });

  it('stores a notification once per dedup key and reports its deliveries', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [NotificationModule] }).compile();
    const facade = moduleRef.get<NotificationFacade>(NOTIFICATION_FACADE);
    const accountId = newId();
    const userId = newId();
    const input = {
      accountId,
      userId,
      type: 'assistant.alert' as const,
      params: { count: 3 },
      title: '3 khách đang chờ',
      body: 'Facebook: 2',
      target: { kind: 'path' as const, path: '/app/inbox' },
      channels: ['in_app' as const, 'push' as const],
      dedupKey: `sched:${newId()}`,
    };
    const first = await facade.notify(input);
    expect(first.deduped).toBe(false);
    expect(await facade.notify(input)).toEqual({ id: first.id, deduped: true });
    const summary = await facade.deliverySummary(accountId, userId, [first.id]);
    // No push adapter configured in this setup: the delivery is skipped at once.
    expect(summary.get(first.id)).toEqual({ push: 'skipped' });
    // An unknown user reads in Vietnamese.
    expect(await facade.recipientLocale(newId())).toBe('vi');
    expect(typeof facade.emailAvailable()).toBe('boolean');
  });
});
