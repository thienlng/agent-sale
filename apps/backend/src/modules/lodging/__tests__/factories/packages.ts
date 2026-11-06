import type { DomainPackage } from '../../domain/rates.js';
import { forPackage, weekday } from './rate-rules.js';

/** Bedroom package builder for lodging domain specs. */
export function pkg(
  id: string,
  unitId: string | null,
  bedrooms: number,
  over: Partial<DomainPackage> = {},
): DomainPackage {
  return {
    id,
    unitId,
    name: `${bedrooms}PN`,
    bedrooms,
    standardAdults: bedrooms * 2,
    standardChildren: 0,
    maxGuests: null,
    sortOrder: bedrooms,
    ...over,
  };
}

/** "Aura Villa 6PN" from the T-193 spec: 4PN is not sold on Saturday. */
export const auraPackages: DomainPackage[] = [
  pkg('pk6', null, 6, { standardAdults: 12, maxGuests: 16, sortOrder: 0 }),
  pkg('pk5', null, 5, { standardAdults: 10, maxGuests: 12, sortOrder: 1 }),
  pkg('pk4', null, 4, { standardAdults: 8, maxGuests: 10, sortOrder: 2 }),
];

export const auraRates = () => [
  forPackage('pk6', weekday(null, [1, 2, 3, 4], 10_000_000)),
  forPackage('pk6', weekday(null, [5], 12_000_000)),
  forPackage('pk6', weekday(null, [6], 18_000_000)),
  forPackage('pk6', weekday(null, [7], 12_000_000)),
  forPackage('pk5', weekday(null, [1, 2, 3, 4], 9_000_000)),
  forPackage('pk5', weekday(null, [5], 11_000_000)),
  forPackage('pk5', weekday(null, [6], 16_000_000)),
  forPackage('pk5', weekday(null, [7], 11_000_000)),
  forPackage('pk4', weekday(null, [1, 2, 3, 4], 8_000_000)),
  forPackage('pk4', weekday(null, [5], 10_000_000)),
  forPackage('pk4', weekday(null, [7], 10_000_000)),
];
