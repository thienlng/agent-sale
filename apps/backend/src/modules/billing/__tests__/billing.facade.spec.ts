import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { BILLING_FACADE } from '../api/index.js';
import { BillingModule } from '../billing.module.js';

/** Contract test: the public API behaves as MODULE.md promises. */
describe('BillingFacade (contract)', () => {
  it('is provided by the module', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [BillingModule] }).compile();
    expect(moduleRef.get(BILLING_FACADE)).toBeDefined();
  });
});
