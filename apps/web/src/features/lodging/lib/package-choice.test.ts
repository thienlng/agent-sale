import type { PackageDto } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import {
  LODGING_IDS,
  propertyFixture,
  unitFixture,
  weekdayRate,
} from '@/testing/lodging-factories';

import { choiceIds, choiceOf, packageOptions, packageTargets, sameIdSet } from './package-choice';
import { fullPackageOf, lowestWeekdaySell, unitsWith } from './units-model';

const pkg = (over: Partial<PackageDto>): PackageDto => ({
  id: '0193a000-0000-7000-8000-000000000701',
  unitId: null,
  name: '6PN',
  bedrooms: 6,
  standardAdults: 12,
  standardChildren: 0,
  maxGuests: 16,
  sortOrder: 0,
  ...over,
});
const P6 = pkg({});
const P4 = pkg({
  id: '0193a000-0000-7000-8000-000000000702',
  name: '4PN',
  bedrooms: 4,
  sortOrder: 1,
});
const R1 = pkg({
  id: '0193a000-0000-7000-8000-000000000703',
  unitId: LODGING_IDS.r1,
  name: '2PN',
  bedrooms: 2,
});

const rooms = propertyFixture({
  id: LODGING_IDS.h1,
  sellMode: 'rooms',
  units: [
    unitFixture({ id: LODGING_IDS.r1, kind: 'room', name: 'B1' }),
    unitFixture({ id: LODGING_IDS.r2, kind: 'room', name: 'B2', sortOrder: 1 }),
  ],
  packages: [R1],
  rates: [
    weekdayRate({ unitId: LODGING_IDS.r1, packageId: R1.id, sell: 3_000_000 }),
    weekdayRate({ unitId: LODGING_IDS.r1, packageId: null, sell: 1_000_000 }),
    weekdayRate({ unitId: LODGING_IDS.r2, weekdays: [1, 2, 3, 4], sell: 2_000_000 }),
    weekdayRate({ unitId: LODGING_IDS.r2, weekdays: [5, 6, 7], sell: 2_500_000 }),
  ],
});

describe('packageTargets', () => {
  it('is the whole property of a whole place with packages, else nothing', () => {
    expect(packageTargets(propertyFixture({ packages: [P6, P4] }), true, [])).toEqual([null]);
    expect(packageTargets(propertyFixture(), true, [])).toEqual([]);
  });

  it('is the chosen rooms that have packages, and every active one of a whole rental', () => {
    expect(packageTargets(rooms, false, [LODGING_IDS.r2, LODGING_IDS.r1])).toEqual([
      LODGING_IDS.r1,
    ]);
    expect(packageTargets(rooms, true, [])).toEqual([LODGING_IDS.r1]);
    const wholePriced = { ...rooms, rates: [...rooms.rates, weekdayRate({ unitId: null })] };
    expect(packageTargets(wholePriced, true, [])).toEqual([]);
  });
});

describe('package choice', () => {
  it('maps stored ids to targets and back, only for the shown targets', () => {
    const p = { ...rooms, packages: [R1, P6] };
    const choice = choiceOf(p, [R1.id]);
    expect(choice).toEqual({ [LODGING_IDS.r1]: R1.id });
    expect(choiceIds(choice, [LODGING_IDS.r1])).toEqual([R1.id]);
    expect(choiceIds(choice, [null])).toEqual([]);
    expect(sameIdSet([R1.id, P6.id], [P6.id, R1.id])).toBe(true);
  });

  it('offers most bedrooms first', () => {
    expect(
      packageOptions(propertyFixture({ packages: [P4, P6] }), null).map((k) => k.name),
    ).toEqual(['6PN', '4PN']);
  });
});

describe('units model', () => {
  it('picks the full package and the lowest weekday sell from its prices', () => {
    expect(fullPackageOf([P4, P6], null)?.name).toBe('6PN');
    expect(lowestWeekdaySell(rooms, LODGING_IDS.r1)).toBe(3_000_000);
    expect(lowestWeekdaySell(rooms, LODGING_IDS.r2)).toBe(2_000_000);
    expect(lowestWeekdaySell(propertyFixture(), LODGING_IDS.r1)).toBeNull();
  });

  it('sends every unit back with all of its fields', () => {
    const gallery = [{ id: 'f1', name: 'Phòng', items: [] }];
    const p = {
      ...rooms,
      units: rooms.units.map((u, i) => (i === 1 ? { ...u, gallery, view: 'Hồ' } : u)),
    };
    const out = unitsWith(p, LODGING_IDS.r1, { name: 'B1 mới' });
    expect(out.map((u) => u.name)).toEqual(['B1 mới', 'B2']);
    expect(out[1]).toMatchObject({ id: LODGING_IDS.r2, gallery, view: 'Hồ' });
  });
});
