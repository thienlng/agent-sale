import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { BOT_FACADE } from '../api/index.js';
import { BotModule } from '../bot.module.js';

/** Contract test: the public API behaves as MODULE.md promises. */
describe('BotFacade (contract)', () => {
  it('is provided by the module', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [BotModule] }).compile();
    expect(moduleRef.get(BOT_FACADE)).toBeDefined();
  });
});
