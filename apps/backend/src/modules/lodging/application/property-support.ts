import type { PackageDto, PropertyDto, UnitDto } from '@agent-sales/contracts';

import { LodgingError } from '../domain/lodging.errors.js';
import { fullPackage, type DomainPackage, type RateRule } from '../domain/rates.js';
import type {
  LodgingTx,
  PackageRecord,
  PropertyRecord,
  UnitRecord,
} from './ports/lodging-store.js';

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

export function toPackageDto({ propertyId: _p, ...pk }: PackageRecord): PackageDto {
  return pk;
}

/** Every package of the property (rates may name any of them), by sort order. */
export function toPropertyDto(
  p: PropertyRecord,
  units: UnitRecord[],
  rates: RateRule[],
  packages: PackageRecord[] = [],
): PropertyDto {
  const { sortOrder: _sort, ...rest } = p;
  return {
    ...rest,
    units: currentUnits(p, units).map(toUnitDto),
    rates,
    packages: packages.filter((pk) => pk.propertyId === p.id).map(toPackageDto),
  };
}

/**
 * Whole-property sell price per ISO weekday (Monday first) from the weekday rates; overrides are
 * ignored. A target with packages is priced with its full package. A room-sold property without
 * a whole rate sums its active rooms; null when a weekday is not fully priced.
 */
export function weekdaySell(
  p: PropertyRecord,
  units: UnitRecord[],
  rates: RateRule[],
  packages: DomainPackage[] = [],
): (number | null)[] {
  const weekdayRules = rates.filter((r) => r.kind === 'weekday');
  const priceOf = (unitId: string | null, day: number) => {
    const packageId = fullPackage(packages, unitId)?.id ?? null;
    return (
      weekdayRules.find(
        (r) => r.unitId === unitId && r.packageId === packageId && r.weekdays.includes(day),
      )?.sell ?? null
    );
  };
  const rooms = p.sellMode === 'rooms' ? currentUnits(p, units).filter((u) => u.active) : [];
  return [1, 2, 3, 4, 5, 6, 7].map((day) => {
    const whole = priceOf(null, day);
    if (whole !== null || rooms.length === 0) return whole;
    const prices = rooms.map((u) => priceOf(u.id, day));
    return prices.every((n) => n !== null)
      ? prices.reduce<number>((a, n) => a + (n ?? 0), 0)
      : null;
  });
}

/** The property with its units, rates and packages, as the API returns it. */
export async function readProperty(tx: LodgingTx, p: PropertyRecord): Promise<PropertyDto> {
  const units = await tx.units([p.id]);
  const rates = await tx.rates([p.id]);
  return toPropertyDto(p, units, rates, await tx.packages([p.id]));
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
