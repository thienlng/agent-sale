import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { TEAM_FACADE } from '../api/index.js';
import { TeamModule } from '../team.module.js';

/** Contract test: the public API behaves as MODULE.md promises. */
describe('TeamFacade (contract)', () => {
  it('is provided by the module', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TeamModule] }).compile();
    expect(moduleRef.get(TEAM_FACADE)).toBeDefined();
  });
});
