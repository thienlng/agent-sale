import type { PropertyDto, UnitDto } from '@agent-sales/contracts';

import { LodgingError } from '../domain/lodging.errors.js';
import type { RateRule } from '../domain/rates.js';
import type { LodgingTx, PropertyRecord, UnitRecord } from './ports/lodging-store.js';

/**
 * Units of the property's current sell mode: the whole unit of a `whole` property, the rooms
 * (active or not) of a `rooms` property. Units of the other mode are kept, deactivated, so a
 * sell-mode switch back reuses them; they are internal and never listed.
 */
export function currentUnits(p: PropertyRecord, units: UnitRecord[]): UnitRecord[] {
  const kind = p.sellMode === 'whole' ? 'whole' : 'room';
  return units.filter((u) => u.propertyId === p.id && u.kind === kind);
}

export function toUnitDto({ propertyId: _p, ...u }: UnitRecord): UnitDto {
  return u;
}

export function toPropertyDto(
  p: PropertyRecord,
  units: UnitRecord[],
  rates: RateRule[],
): PropertyDto {
  const { sortOrder: _sort, ...rest } = p;
  return { ...rest, units: currentUnits(p, units).map(toUnitDto), rates };
}

/** The property with its units and rates, as the API returns it. */
export async function readProperty(tx: LodgingTx, p: PropertyRecord): Promise<PropertyDto> {
  const [units, rates] = [await tx.units([p.id]), await tx.rates([p.id])];
  return toPropertyDto(p, units, rates);
}

/**
 * Locks the property row (FOR NO KEY UPDATE) and checks the optimistic version the client
 * edited against; every property write (info, rooms, rates, overrides) goes through here.
 */
export async function lockForWrite(
  tx: LodgingTx,
  id: string,
  version: number,
): Promise<PropertyRecord> {
  const p = await tx.property(id, true);
  if (!p) throw new LodgingError('NOT_FOUND', 'Property not found');
  if (p.version !== version) {
    throw new LodgingError('STALE_VERSION', 'The property changed; reload before saving', {
      version: p.version,
    });
  }
  return p;
}

/** Saves `p` with the next version. */
export async function saveBumped(tx: LodgingTx, p: PropertyRecord): Promise<PropertyRecord> {
  const next = { ...p, version: p.version + 1, updatedAt: new Date().toISOString() };
  await tx.updateProperty(next);
  return next;
}

/**
 * A rate target must belong to the property: a `whole` property prices only the whole
 * property (null); a `rooms` property prices the whole property (null) or one of its rooms.
 */
export function assertRateTarget(
  p: PropertyRecord,
  units: UnitRecord[],
  unitId: string | null,
): void {
  if (unitId === null) return;
  const room = units.find((u) => u.id === unitId && u.propertyId === p.id && u.kind === 'room');
  if (p.sellMode === 'whole' || !room) {
    throw new LodgingError(
      'VALIDATION_FAILED',
      'A price must target the whole property or one of its rooms',
      {
        unitId,
      },
    );
  }
}
