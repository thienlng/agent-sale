import type { PackageDto, PropertyDto, UnitDto, UnitInput } from '@agent-sales/contracts';

/** Rental units per property (server limit of `PUT units`). */
export const MAX_UNITS = 100;

/** The rental units (rooms, bungalows, houses) of a `rooms` property, in their saved order. */
export const roomUnits = (p: PropertyDto): UnitDto[] => p.units.filter((u) => u.kind === 'room');

/** A loaded unit as a `PUT units` entry: every field is sent back, so nothing is reset. */
export const unitInputOf = (u: UnitDto): UnitInput => ({
  id: u.id,
  name: u.name,
  beds: u.beds,
  capacityAdults: u.capacityAdults,
  capacityChildren: u.capacityChildren,
  active: u.active,
  category: u.category,
  view: u.view,
  areaM2: u.areaM2,
  description: u.description,
  amenities: u.amenities,
  maxGuests: u.maxGuests,
  gallery: u.gallery,
  galleryCover: u.galleryCover,
});

/** Every unit as loaded, with `patch` applied to the unit `unitId`. */
export function unitsWith(p: PropertyDto, unitId: string, patch: Partial<UnitInput>): UnitInput[] {
  return roomUnits(p).map((u) =>
    u.id === unitId ? { ...unitInputOf(u), ...patch } : unitInputOf(u),
  );
}

/** The packages of one target (`null` = the whole property), in their saved order. */
export const targetPackages = (packages: PackageDto[], target: string | null): PackageDto[] =>
  packages.filter((k) => k.unitId === target).sort((a, b) => a.sortOrder - b.sortOrder);

/** The full package of a target: most bedrooms, ties → the later sort order (as the server). */
export function fullPackageOf(
  packages: PackageDto[],
  target: string | null,
): PackageDto | undefined {
  let best: PackageDto | undefined;
  for (const k of targetPackages(packages, target))
    if (
      !best ||
      k.bedrooms > best.bedrooms ||
      (k.bedrooms === best.bedrooms && k.sortOrder >= best.sortOrder)
    )
      best = k;
  return best;
}

/**
 * "từ X" of a unit card: the lowest weekday sell of the unit, read from its full package's
 * prices when it has packages (smaller packages are not always sold); null without prices.
 */
export function lowestWeekdaySell(p: PropertyDto, unitId: string): number | null {
  const full = fullPackageOf(p.packages, unitId);
  const sells = p.rates
    .filter(
      (r) => r.kind === 'weekday' && r.unitId === unitId && r.packageId === (full ? full.id : null),
    )
    .map((r) => r.sell);
  return sells.length ? Math.min(...sells) : null;
}
