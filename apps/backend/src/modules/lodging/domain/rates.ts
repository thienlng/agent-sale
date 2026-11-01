import { LodgingError } from './lodging.errors.js';
import { isoWeekday } from './nights.js';

/** One price rule. `unitId` null = the whole property; override dates are inclusive nights. */
export interface RateRule {
  id: string;
  unitId: string | null;
  kind: 'weekday' | 'override';
  weekdays: number[];
  dateFrom: string | null;
  dateTo: string | null;
  label: string;
  sell: number;
  cost: number;
  minNights: number | null;
}

export interface NightPrice {
  sell: number;
  cost: number;
  label: string;
  minNights: number | null;
}

/** Each target (null = whole property, or a room id) prices weekdays 1..7 exactly once. */
export function assertWeekdayCoverage(rules: RateRule[], targets: (string | null)[]): void {
  for (const target of targets) {
    const days = rules
      .filter((r) => r.kind === 'weekday' && r.unitId === target)
      .flatMap((r) => r.weekdays);
    const complete =
      days.length === 7 &&
      new Set(days).size === 7 &&
      days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7);
    if (!complete) {
      throw new LodgingError('VALIDATION_FAILED', 'Each weekday must be priced exactly once', {
        unitId: target,
        weekdays: days,
      });
    }
  }
}

/** Overrides of one target never overlap (inclusive ranges) and never run backwards. */
export function assertNoOverrideOverlap(rules: RateRule[]): void {
  const ranges = rules
    .filter((r) => r.kind === 'override')
    .map((r) => {
      if (!r.dateFrom || !r.dateTo || r.dateFrom > r.dateTo) {
        throw new LodgingError('VALIDATION_FAILED', 'An override needs dateFrom ≤ dateTo', {
          rateId: r.id,
        });
      }
      return { id: r.id, unitId: r.unitId, from: r.dateFrom, to: r.dateTo };
    });
  ranges.forEach((a, i) => {
    for (const b of ranges.slice(i + 1)) {
      if (a.unitId === b.unitId && a.from <= b.to && b.from <= a.to) {
        throw new LodgingError('VALIDATION_FAILED', 'Date-range prices overlap', {
          rateIds: [a.id, b.id],
        });
      }
    }
  });
}

/** Price of one night for one target: a matching override wins over the weekday rate. */
export function priceNight(
  rules: RateRule[],
  unitId: string | null,
  night: string,
): NightPrice | null {
  const own = rules.filter((r) => r.unitId === unitId);
  const weekday = isoWeekday(night);
  const hit =
    own.find(
      (r) =>
        r.kind === 'override' &&
        r.dateFrom !== null &&
        r.dateTo !== null &&
        r.dateFrom <= night &&
        night <= r.dateTo,
    ) ?? own.find((r) => r.kind === 'weekday' && r.weekdays.includes(weekday));
  if (!hit) return null;
  return {
    sell: hit.sell,
    cost: hit.cost,
    label: hit.kind === 'override' ? hit.label : '',
    minNights: hit.kind === 'override' ? hit.minNights : null,
  };
}
