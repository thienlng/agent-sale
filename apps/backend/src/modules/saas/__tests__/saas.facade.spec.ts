import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { SAAS_RUNNER } from '../api/index.js';
import { SaasModule } from '../saas.module.js';

/**
 * Contract test: the public API behaves as MODULE.md promises. saas has no facade since the bot's
 * request writer moved to crm (ADR-025); its public API is the runner and its events.
 */
describe('saas public API (contract)', () => {
  it('provides the runner', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SaasModule] }).compile();
    expect(moduleRef.get(SAAS_RUNNER)).toBeDefined();
  });
});
