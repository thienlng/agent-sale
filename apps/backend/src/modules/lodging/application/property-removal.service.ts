import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { LodgingError } from '../domain/lodging.errors.js';
import { LodgingAccess } from './lodging-access.js';
import { LODGING_STORE, type LodgingStore } from './ports/lodging-store.js';

/** `details.reason` of the 409 answered when a property with bookings is deleted. */
export const PROPERTY_HAS_BOOKINGS = 'property_has_bookings';

/**
 * Hard delete of a property. One with bookings or blocks (any status) is refused with the counts
 * unless the owner confirmed `withBookings`: then its bookings go too (audited with the counts),
 * and staff who want to keep the history pause it instead. Gallery objects stay in storage: the same object can be referenced by a product or a
 * copied property, and no media removal tracks references yet (as for a removed gallery item).
 */
@Injectable()
export class PropertyRemovalService {
  constructor(
    @Inject(LODGING_STORE) private readonly store: LodgingStore,
    @Inject(LodgingAccess) private readonly access: LodgingAccess,
  ) {}

  async remove(
    ws: WorkspaceId,
    id: string,
    actorId: string,
    opts: { withBookings?: boolean } = {},
  ): Promise<void> {
    await this.access.assertHotel(ws);
    await this.store.run(ws, async (tx) => {
      const p = await tx.property(id, true);
      if (!p) throw new LodgingError('NOT_FOUND', 'Property not found');
      const bookings = await tx.propertyBookings(p.id);
      if (bookings.total > 0 && !opts.withBookings) {
        throw new LodgingError('CONFLICT', 'The property has bookings; confirm deleting them too', {
          reason: PROPERTY_HAS_BOOKINGS,
          bookings: bookings.total,
          upcoming: bookings.upcoming,
        });
      }
      await tx.deleteProperty(p.id, { withBookings: bookings.total > 0 });
      await tx.audit(actorId, 'lodging_property', p.id, 'lodging.property.deleted', {
        code: p.code,
        sellMode: p.sellMode,
        ...(bookings.total > 0
          ? { deletedBookings: bookings.total, deletedUpcoming: bookings.upcoming }
          : {}),
      });
    });
  }
}
