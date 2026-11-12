import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { LodgingError } from '../domain/lodging.errors.js';
import { LodgingAccess } from './lodging-access.js';
import { LODGING_STORE, type LodgingStore } from './ports/lodging-store.js';

/** `details.reason` of the 409 answered when a property with bookings is deleted. */
export const PROPERTY_HAS_BOOKINGS = 'property_has_bookings';

/**
 * Hard delete of a property that never had a booking (a property created by mistake or never
 * sold). A property with any booking or block, in any status, keeps its history: staff pause it
 * instead. Gallery objects stay in storage: the same object can be referenced by a product or a
 * copied property, and no media removal tracks references yet (as for a removed gallery item).
 */
@Injectable()
export class PropertyRemovalService {
  constructor(
    @Inject(LODGING_STORE) private readonly store: LodgingStore,
    @Inject(LodgingAccess) private readonly access: LodgingAccess,
  ) {}

  async remove(ws: WorkspaceId, id: string, actorId: string): Promise<void> {
    await this.access.assertHotel(ws);
    await this.store.run(ws, async (tx) => {
      const p = await tx.property(id, true);
      if (!p) throw new LodgingError('NOT_FOUND', 'Property not found');
      if (await tx.propertyHasBookings(p.id)) {
        throw new LodgingError('CONFLICT', 'A property with bookings cannot be deleted', {
          reason: PROPERTY_HAS_BOOKINGS,
        });
      }
      await tx.deleteProperty(p.id);
      await tx.audit(actorId, 'lodging_property', p.id, 'lodging.property.deleted', {
        code: p.code,
        sellMode: p.sellMode,
      });
    });
  }
}
