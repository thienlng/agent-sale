import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { NOTIFICATION_FACADE } from '../api/index.js';
import { NotificationModule } from '../notification.module.js';

/** Contract test: the public API behaves as MODULE.md promises. */
describe('NotificationFacade (contract)', () => {
  it('is provided by the module', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [NotificationModule] }).compile();
    expect(moduleRef.get(NOTIFICATION_FACADE)).toBeDefined();
  });
});
