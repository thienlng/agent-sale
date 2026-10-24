import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { CRM_FACADE } from '../api/index.js';
import { CrmModule } from '../crm.module.js';

/** Contract test: the public API behaves as MODULE.md promises. */
describe('CrmFacade (contract)', () => {
  it('is provided by the module', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [CrmModule] }).compile();
    expect(moduleRef.get(CRM_FACADE)).toBeDefined();
  });
});
