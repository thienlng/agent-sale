import {
  PropertyInput,
  type PropertyDto,
  type PropertySummary,
  type ReplaceUnitsRequest,
  type UpdatePropertyRequest,
} from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';

import { LodgingError } from '../domain/lodging.errors.js';
import { addNights, localToday } from '../domain/nights.js';
import { expireHolds } from './booking-support.js';
import { LodgingAccess } from './lodging-access.js';
import {
  LODGING_STORE,
  type BookingRecord,
  type LodgingStore,
  type LodgingTx,
  type PropertyRecord,
  type TakenNight,
  type UnitRecord,
} from './ports/lodging-store.js';
import {
  currentUnits,
  lockForWrite,
  readProperty,
  saveBumped,
  toPropertyDto,
  toUnitDto,
} from './property-support.js';

type PropertyFieldsOut = z.output<typeof PropertyInput>;
type Today = PropertySummary['today'];

/** Every editable property field (PropertyInput keys) of a stored property. */
function fieldsOf(p: PropertyRecord): PropertyFieldsOut {
  return {
    code: p.code,
    name: p.name,
    area: p.area,
    address: p.address,
    description: p.description,
    sellMode: p.sellMode,
    status: p.status,
    standardAdults: p.standardAdults,
    standardChildren: p.standardChildren,
    maxGuests: p.maxGuests,
    childFreeBelow: p.childFreeBelow,
    childAdultFrom: p.childAdultFrom,
    amenities: p.amenities,
    layout: p.layout,
    policies: p.policies,
    gallery: p.gallery,
  };
}

function validationError(issues: z.core.$ZodIssue[]): LodgingError {
  return new LodgingError('VALIDATION_FAILED', 'Property validation failed', {
    issues: issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}

/** The single whole unit follows the property's name and standard capacity. */
function wholeUnit(p: PropertyRecord, existing?: UnitRecord): UnitRecord {
  return {
    id: existing?.id ?? newId(),
    propertyId: p.id,
    kind: 'whole',
    name: p.name,
    beds: existing?.beds ?? '',
    capacityAdults: p.standardAdults,
    capacityChildren: p.standardChildren,
    active: true,
    sortOrder: 0,
  };
}

/**
 * Today's status of one property from the unit-nights taken tonight: `free` when nothing is
 * taken, `partial` when only some units are, otherwise `hold` (any hold), `blocked` (only
 * blocks) or `occupied` (stays, possibly next to blocks). Overdue holds count as free.
 */
export function todayStatus(
  units: UnitRecord[],
  taken: TakenNight[],
  bookings: Map<string, BookingRecord>,
  now: Date,
): Today {
  const active = units.filter((u) => u.active);
  const live = (n: TakenNight) => {
    const b = bookings.get(n.bookingId);
    return !(b?.status === 'hold' && b.holdExpiresAt !== null && new Date(b.holdExpiresAt) <= now);
  };
  const byUnit = new Map(taken.filter(live).map((n) => [n.unitId, bookings.get(n.bookingId)]));
  const covering = active.filter((u) => byUnit.has(u.id)).map((u) => byUnit.get(u.id));
  if (covering.length === 0) return 'free';
  if (covering.length < active.length) return 'partial';
  if (covering.some((b) => b?.status === 'hold')) return 'hold';
  if (covering.every((b) => b?.kind === 'block')) return 'blocked';
  return 'occupied';
}

/** Properties, their whole unit or rooms, and the property's own fields (spec §3.1–3.2). */
@Injectable()
export class PropertyService {
  constructor(
    @Inject(LODGING_STORE) private readonly store: LodgingStore,
    @Inject(LodgingAccess) private readonly access: LodgingAccess,
  ) {}

  async list(ws: WorkspaceId): Promise<{ data: PropertySummary[] }> {
    await this.access.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      const now = new Date();
      await expireHolds(tx, now);
      const props = await tx.properties();
      const ids = props.map((p) => p.id);
      const units = await tx.units(ids);
      const today = localToday(now);
      const tomorrow = addNights(today, 1);
      const taken = await tx.takenNights(
        units.map((u) => u.id),
        today,
        tomorrow,
      );
      const bookings = new Map(
        (await tx.bookingsInRange(ids, today, tomorrow)).map((b) => [b.id, b]),
      );
      return {
        data: props.map((p) => {
          const own = currentUnits(p, units);
          const { sortOrder: _s, ...rest } = p;
          return {
            ...rest,
            units: own.map(toUnitDto),
            today: todayStatus(own, taken, bookings, now),
          };
        }),
      };
    });
  }

  async get(ws: WorkspaceId, id: string): Promise<PropertyDto> {
    await this.access.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      const p = await tx.property(id);
      if (!p) throw new LodgingError('NOT_FOUND', 'Property not found');
      return readProperty(tx, p);
    });
  }

  /**
   * A `whole` property gets its single whole unit; a `rooms` property starts without rooms.
   * Bots with an explicit property list get the new property too (bots without one sell all).
   */
  async create(ws: WorkspaceId, input: PropertyFieldsOut, actorId: string): Promise<PropertyDto> {
    await this.access.assertHotel(ws);
    const parsed = PropertyInput.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error.issues);
    const fields = parsed.data;
    return this.store.run(ws, async (tx) => {
      const now = new Date().toISOString();
      const p: PropertyRecord = {
        ...fields,
        id: newId(),
        surcharges: { extraAdult: null, extraChild: null },
        sortOrder: 0,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await tx.insertProperty(p);
      const units = p.sellMode === 'whole' ? [wholeUnit(p)] : [];
      if (units.length > 0) await tx.replaceUnits(p.id, units);
      await tx.addPropertyToBots(p.id);
      await tx.audit(actorId, 'lodging_property', p.id, 'lodging.property.created', {
        code: p.code,
        sellMode: p.sellMode,
      });
      return toPropertyDto(p, units, []);
    });
  }

  /**
   * Partial update. The merged property is validated as a whole (childFreeBelow ≤ childAdultFrom);
   * a sent `policies` / `layout` / `gallery` replaces the stored one. A sell-mode switch is
   * refused while a booking still occupies tonight or a later night.
   */
  async update(
    ws: WorkspaceId,
    id: string,
    input: UpdatePropertyRequest,
    actorId: string,
  ): Promise<PropertyDto> {
    await this.access.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      const p = await lockForWrite(tx, id, input.version);
      const merged = PropertyInput.safeParse({ ...fieldsOf(p), ...input.patch });
      if (!merged.success) throw validationError(merged.error.issues);
      const next = { ...p, ...merged.data };
      if (next.sellMode !== p.sellMode) await this.assertNoFutureBookings(tx, p.id);
      await syncUnits(tx, next, await tx.units([p.id]));
      const saved = await saveBumped(tx, next);
      await tx.audit(actorId, 'lodging_property', p.id, 'lodging.property.updated', {
        fields: Object.keys(input.patch),
      });
      return readProperty(tx, saved);
    });
  }

  /** Replaces the rooms of a `rooms` property; a room that has bookings can only be deactivated. */
  async replaceUnits(
    ws: WorkspaceId,
    id: string,
    input: ReplaceUnitsRequest,
    actorId: string,
  ): Promise<PropertyDto> {
    await this.access.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      const p = await lockForWrite(tx, id, input.version);
      if (p.sellMode !== 'rooms') {
        throw new LodgingError('CONFLICT', 'Rooms can only be edited on a property sold by room');
      }
      const existing = await tx.units([p.id]);
      const roomIds = new Set(existing.filter((u) => u.kind === 'room').map((u) => u.id));
      const given = input.units.flatMap((u) => (u.id ? [u.id] : []));
      if (new Set(given).size !== given.length) {
        throw new LodgingError('VALIDATION_FAILED', 'A room is listed twice');
      }
      const foreign = given.filter((uid) => !roomIds.has(uid));
      if (foreign.length > 0) {
        throw new LodgingError('VALIDATION_FAILED', 'A room does not belong to this property', {
          unitIds: foreign,
        });
      }
      const rooms: UnitRecord[] = input.units.map((u, i) => ({
        id: u.id ?? newId(),
        propertyId: p.id,
        kind: 'room',
        name: u.name,
        beds: u.beds,
        capacityAdults: u.capacityAdults,
        capacityChildren: u.capacityChildren,
        active: u.active,
        sortOrder: i,
      }));
      // The deactivated whole unit stays (it may hold past nights and is reused on a switch back).
      const units = [...existing.filter((u) => u.kind === 'whole'), ...rooms];
      await tx.replaceUnits(p.id, units);
      const saved = await saveBumped(tx, p);
      await tx.audit(actorId, 'lodging_property', p.id, 'lodging.property.units_replaced', {
        rooms: rooms.length,
      });
      return toPropertyDto(saved, units, await tx.rates([p.id]));
    });
  }

  private async assertNoFutureBookings(tx: LodgingTx, propertyId: string): Promise<void> {
    const now = new Date();
    await expireHolds(tx, now);
    const today = localToday(now);
    const future = await tx.bookingsInRange([propertyId], today, '9999-12-31');
    if (future.length > 0) {
      throw new LodgingError(
        'CONFLICT',
        'The sell mode cannot change while bookings occupy tonight or later nights',
        { codes: future.map((b) => b.code) },
      );
    }
  }
}

/**
 * Units after an update: a `whole` property has exactly one active whole unit that follows the
 * property (rooms are deactivated); a `rooms` property has its whole unit deactivated.
 */
async function syncUnits(tx: LodgingTx, p: PropertyRecord, units: UnitRecord[]): Promise<void> {
  const whole = units.find((u) => u.kind === 'whole');
  const rooms = units.filter((u) => u.kind === 'room');
  if (p.sellMode === 'whole') {
    await tx.replaceUnits(p.id, [
      wholeUnit(p, whole),
      ...rooms.map((u) => ({ ...u, active: false })),
    ]);
  } else if (whole?.active) {
    await tx.replaceUnits(p.id, [{ ...whole, active: false }, ...rooms]);
  }
}
