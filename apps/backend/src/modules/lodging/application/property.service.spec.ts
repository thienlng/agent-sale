import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import { LodgingError } from '../domain/lodging.errors.js';
import type { LodgingAccess } from './lodging-access.js';
import type { LodgingStore } from './ports/lodging-store.js';
import { PropertyService } from './property.service.js';

describe('PropertyService.create', () => {
  it('reports an invalid property as VALIDATION_FAILED, not a raw ZodError', async () => {
    const run = vi.fn();
    const service = new PropertyService(
      { run } as unknown as LodgingStore,
      {
        assertHotel: () => Promise.resolve(),
      } as unknown as LodgingAccess,
    );
    const bad = {
      code: 'A17',
      name: 'Villa',
      sellMode: 'whole',
      childFreeBelow: 12,
      childAdultFrom: 6,
    };
    const err = await service
      .create(workspaceId('01890000-0000-7000-8000-000000000001'), bad as never, 'actor')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LodgingError);
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(run).not.toHaveBeenCalled();
  });
});
