import { workspaceId } from '@agent-sales/shared';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { LODGING_BOT_FACADE, LODGING_CATALOG_FACADE, LODGING_FACADE } from '../api/index.js';
import { LodgingFacadeImpl } from '../application/lodging.facade.impl.js';
import type { LodgingStore } from '../application/ports/lodging-store.js';
import { LodgingModule } from '../lodging.module.js';

const ws = workspaceId('01890000-0000-7000-8000-000000000001');

/** Contract test: the public API behaves as MODULE.md promises. */
describe('LodgingFacade (contract)', () => {
  it('is provided by the module, with the bot catalog and the bot holds', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [LodgingModule] }).compile();
    expect(moduleRef.get(LODGING_FACADE)).toBeDefined();
    expect(moduleRef.get(LODGING_CATALOG_FACADE)).toBeDefined();
    expect(moduleRef.get(LODGING_BOT_FACADE)).toBeDefined();
  });

  it('lists the bot properties: its selection, or every active property without one', async () => {
    const store = (ids: string[] | null): LodgingStore =>
      ({
        run: (_ws, fn) =>
          fn({
            botPropertyIds: async () => ids,
            properties: async (f: { activeOnly?: boolean } = {}) =>
              [
                { id: 'p1', status: 'active' },
                { id: 'p2', status: 'paused' },
              ].filter((p) => !f.activeOnly || p.status === 'active'),
          } as never),
      }) as LodgingStore;
    expect(await new LodgingFacadeImpl(store(['p2'])).listBotPropertyIds(ws, 'b')).toEqual(['p2']);
    expect(await new LodgingFacadeImpl(store(null)).listBotPropertyIds(ws, 'b')).toEqual(['p1']);
  });
});
