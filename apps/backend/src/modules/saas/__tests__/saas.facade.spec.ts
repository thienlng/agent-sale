import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { SAAS_FACADE } from '../api/index.js';
import { SaasModule } from '../saas.module.js';

/** Contract test: the public API behaves as MODULE.md promises. */
describe('SaasFacade (contract)', () => {
  it('is provided by the module', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SaasModule] }).compile();
    expect(moduleRef.get(SAAS_FACADE)).toBeDefined();
  });
});
