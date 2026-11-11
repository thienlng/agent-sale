import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { BRAIN_FACADE } from '../api/index.js';
import { BrainModule } from '../brain.module.js';

/** Contract test: the public API behaves as MODULE.md promises. */
describe('BrainFacade (contract)', () => {
  it('is provided by the module', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [BrainModule] }).compile();
    expect(moduleRef.get(BRAIN_FACADE)).toBeDefined();
  });
});
