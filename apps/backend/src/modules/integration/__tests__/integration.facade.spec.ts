import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { INTEGRATION_FACADE } from '../api/index.js';
import { IntegrationModule } from '../integration.module.js';

/** Contract test: the public API behaves as MODULE.md promises. */
describe('IntegrationFacade (contract)', () => {
  it('is provided by the module', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [IntegrationModule] }).compile();
    expect(moduleRef.get(INTEGRATION_FACADE)).toBeDefined();
  });
});
