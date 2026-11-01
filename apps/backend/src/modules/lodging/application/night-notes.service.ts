import type { NightNoteResult, PutNightNoteRequest } from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { LodgingError } from '../domain/lodging.errors.js';
import { LodgingAccess } from './lodging-access.js';
import { LODGING_STORE, type LodgingStore } from './ports/lodging-store.js';

/**
 * Staff-only notes on one night of a property (`unitId` null) or of one of its rooms. Internal:
 * shown on the calendar, never to the bot. An empty text deletes the note.
 */
@Injectable()
export class NightNotesService {
  constructor(
    @Inject(LODGING_STORE) private readonly store: LodgingStore,
    @Inject(LodgingAccess) private readonly access: LodgingAccess,
  ) {}

  async put(
    ws: WorkspaceId,
    propertyId: string,
    req: PutNightNoteRequest,
    actorId: string,
  ): Promise<NightNoteResult> {
    await this.access.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      const p = await tx.property(propertyId);
      if (!p) throw new LodgingError('NOT_FOUND', 'Property not found');
      if (req.unitId !== null) {
        const [room] = (await tx.units([p.id])).filter(
          (u) => u.id === req.unitId && u.kind === 'room',
        );
        if (p.sellMode !== 'rooms' || !room) {
          throw new LodgingError(
            'VALIDATION_FAILED',
            'A note must target the property or one of its rooms',
            { unitId: req.unitId },
          );
        }
      }
      if (req.text === '') {
        await tx.deleteNightNote(p.id, req.unitId, req.night);
        return { note: null };
      }
      const { propertyId: _p, ...note } = await tx.upsertNightNote(
        { id: newId(), propertyId: p.id, unitId: req.unitId, night: req.night, text: req.text },
        actorId,
      );
      return { note };
    });
  }
}
