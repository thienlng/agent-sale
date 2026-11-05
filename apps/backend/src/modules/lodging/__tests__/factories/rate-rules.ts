import type { RateRule } from '../../domain/rates.js';

/** Rate rule builders for lodging domain specs. Cost defaults to sell. */
let seq = 0;
export function weekday(
  unitId: string | null,
  weekdays: number[],
  sell: number,
  cost = sell,
): RateRule {
  seq += 1;
  return {
    id: `w${seq}`,
    unitId,
    kind: 'weekday',
    weekdays,
    dateFrom: null,
    dateTo: null,
    label: '',
    sell,
    cost,
    minNights: null,
    packageId: null,
  };
}

export function override(
  unitId: string | null,
  dateFrom: string,
  dateTo: string,
  sell: number,
  label = 'Override',
  minNights: number | null = null,
): RateRule {
  seq += 1;
  return {
    id: `o${seq}`,
    unitId,
    kind: 'override',
    weekdays: [],
    dateFrom,
    dateTo,
    label,
    sell,
    cost: sell,
    minNights,
    packageId: null,
  };
}

/** The same rule priced for one bedroom package of its target. */
export function forPackage(packageId: string, rule: RateRule): RateRule {
  return { ...rule, packageId };
}
