import { workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import { LodgingError } from '../domain/lodging.errors.js';
import type { LodgingAccess } from './lodging-access.js';
import type { LodgingStore, LodgingTx, PropertyRecord } from './ports/lodging-store.js';
import { PropertyRemovalService } from './property-removal.service.js';

const ws = workspaceId('01890000-0000-7000-8000-000000000001');
const other = workspaceId('01890000-0000-7000-8000-000000000002');
const villaId = '01890000-0000-7000-8000-0000000000a1';

/** One property per workspace; the store's RLS is the workspace filter of `property`. */
function setup(opts: { bookings?: boolean; hotel?: boolean } = {}) {
  const properties = new Map<WorkspaceId, Set<string>>([[ws, new Set([villaId])]]);
  const calls: string[] = [];
  const audit = vi.fn();
  const store: LodgingStore = {
    run: (w, fn) => {
      const own = properties.get(w) ?? new Set<string>();
      const tx = {
        property: (id: string, lock?: boolean) => {
          calls.push(`property:${String(lock)}`);
          return Promise.resolve(
            own.has(id) ? ({ id, code: 'A17', sellMode: 'whole' } as PropertyRecord) : null,
          );
        },
        propertyHasBookings: () => Promise.resolve(opts.bookings ?? false),
        deleteProperty: (id: string) => {
          own.delete(id);
          calls.push('delete');
          return Promise.resolve();
        },
        audit,
      } as unknown as LodgingTx;
      return fn(tx);
    },
  };
  const access = {
    assertHotel: () =>
      opts.hotel === false
        ? Promise.reject(new LodgingError('NOT_FOUND', 'Not a hotel'))
        : Promise.resolve(),
  } as unknown as LodgingAccess;
  return { service: new PropertyRemovalService(store, access), properties, calls, audit };
}

describe('PropertyRemovalService.remove', () => {
  it('deletes a property without bookings under a row lock and audits it', async () => {
    const { service, properties, calls, audit } = setup();
    await service.remove(ws, villaId, 'actor-1');
    expect(properties.get(ws)?.has(villaId)).toBe(false);
    expect(calls).toEqual(['property:true', 'delete']);
    expect(audit).toHaveBeenCalledWith(
      'actor-1',
      'lodging_property',
      villaId,
      'lodging.property.deleted',
      { code: 'A17', sellMode: 'whole' },
    );
  });

  it('refuses a property with bookings with 409 property_has_bookings', async () => {
    const { service, properties, audit } = setup({ bookings: true });
    const err = await service.remove(ws, villaId, 'actor-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LodgingError);
    expect(err).toMatchObject({ code: 'CONFLICT', details: { reason: 'property_has_bookings' } });
    expect(properties.get(ws)?.has(villaId)).toBe(true);
    expect(audit).not.toHaveBeenCalled();
  });

  it("answers NOT_FOUND for another workspace's property", async () => {
    const { service, properties } = setup();
    const err = await service.remove(other, villaId, 'actor-1').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'NOT_FOUND' });
    expect(properties.get(ws)?.has(villaId)).toBe(true);
  });

  it('answers NOT_FOUND for a business that is not a hotel', async () => {
    const { service, calls } = setup({ hotel: false });
    expect(await service.remove(ws, villaId, 'actor-1').catch((e: unknown) => e)).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(calls).toEqual([]);
  });
});
