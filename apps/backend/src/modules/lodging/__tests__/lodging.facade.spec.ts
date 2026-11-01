import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { LODGING_FACADE } from '../api/index.js';
import { LodgingModule } from '../lodging.module.js';

/** Contract test: the public API behaves as MODULE.md promises. */
describe('LodgingFacade (contract)', () => {
  it('is provided by the module', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [LodgingModule] }).compile();
    expect(moduleRef.get(LODGING_FACADE)).toBeDefined();
  });
});
