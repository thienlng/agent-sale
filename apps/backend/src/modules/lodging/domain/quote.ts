import { LodgingError } from './lodging.errors.js';
import { isoWeekday, nightsBetween } from './nights.js';
import { priceNight, type NightPrice, type RateRule } from './rates.js';

export interface QuoteProperty {
  sellMode: 'whole' | 'rooms';
  standardAdults: number;
  standardChildren: number;
  maxGuests: number | null;
  childFreeBelow: number;
  childAdultFrom: number;
  surcharges: {
    extraAdult: { sell: number; cost: number } | null;
    extraChild: { sell: number; cost: number } | null;
  };
}

export interface QuoteUnit {
  id: string;
  kind: 'whole' | 'room';
  capacityAdults: number;
  capacityChildren: number;
  active: boolean;
}

export interface QuoteInput {
  whole: boolean;
  unitIds: string[];
  checkIn: string;
  checkOut: string;
  adults: number;
  childAges: number[];
}

export type QuoteWarning =
  'min_nights' | 'missing_rate' | 'over_max' | 'over_standard' | 'child_ages_missing';

export interface QuoteLineNight {
  date: string;
  weekday: number;
  label: string;
  sell: number;
  cost: number;
}

export interface QuoteLineSurcharge {
  kind: 'extra_adult' | 'extra_child';
  persons: number;
  nights: number;
  sell: number;
  cost: number;
}

export interface Quote {
  nights: QuoteLineNight[];
  surcharges: QuoteLineSurcharge[];
  totalSell: number | null;
  totalCost: number | null;
  warnings: QuoteWarning[];
}

const WARNING_ORDER: readonly QuoteWarning[] = [
  'min_nights',
  'missing_rate',
  'over_max',
  'over_standard',
  'child_ages_missing',
];

/** The unit ids a selection takes. Whole: the whole unit, or every active room. */
export function resolveUnits(
  p: QuoteProperty,
  units: QuoteUnit[],
  input: Pick<QuoteInput, 'whole' | 'unitIds'>,
): string[] {
  if (input.whole) {
    const kind = p.sellMode === 'whole' ? 'whole' : 'room';
    const ids = units.filter((u) => u.active && u.kind === kind).map((u) => u.id);
    if (ids.length === 0) {
      throw new LodgingError('VALIDATION_FAILED', 'The property has no bookable unit');
    }
    return ids;
  }
  if (p.sellMode === 'whole') {
    throw new LodgingError('VALIDATION_FAILED', 'A whole property is only rented whole');
  }
  if (input.unitIds.length === 0) {
    throw new LodgingError('VALIDATION_FAILED', 'Choose at least one room');
  }
  const ids = [...new Set(input.unitIds)];
  for (const id of ids) {
    const unit = units.find((u) => u.id === id);
    if (!unit || unit.kind !== 'room' || !unit.active) {
      throw new LodgingError('VALIDATION_FAILED', 'Unknown or inactive room', { unitId: id });
    }
  }
  return ids;
}

/** Prices a stay from rules (override wins, else weekday) plus per-person surcharges. */
export function quoteStay(
  p: QuoteProperty,
  units: QuoteUnit[],
  rules: RateRule[],
  input: QuoteInput,
): Quote {
  const nights = nightsBetween(input.checkIn, input.checkOut);
  const unitIds = resolveUnits(p, units, input);
  /**
   * Targets priced for one night. Whole property: the whole target only. Whole rental of a
   * rooms property: a whole-target rate for that night if any (override, else weekday — see
   * `priceNight`), otherwise the sum of the active rooms. Room selection: the selected rooms.
   */
  const targetsFor = (night: string): (string | null)[] => {
    if (!input.whole) return unitIds;
    if (p.sellMode === 'whole') return [null];
    return priceNight(rules, null, night) ? [null] : unitIds;
  };
  const warnings = new Set<QuoteWarning>();

  const nightLines = nights.map((date): QuoteLineNight => {
    const line: QuoteLineNight = { date, weekday: isoWeekday(date), label: '', sell: 0, cost: 0 };
    const prices: NightPrice[] = [];
    for (const t of targetsFor(date)) {
      const price = priceNight(rules, t, date);
      if (!price) {
        warnings.add('missing_rate');
        return line;
      }
      prices.push(price);
    }
    for (const price of prices) {
      line.sell += price.sell;
      line.cost += price.cost;
      if (!line.label && price.label) line.label = price.label;
      if (price.minNights !== null && price.minNights > nights.length) warnings.add('min_nights');
    }
    return line;
  });

  const selected = units.filter((u) => unitIds.includes(u.id));
  const standard = input.whole
    ? { adults: p.standardAdults, children: p.standardChildren }
    : {
        adults: selected.reduce((s, u) => s + u.capacityAdults, 0),
        children: selected.reduce((s, u) => s + u.capacityChildren, 0),
      };

  let small = 0;
  let child = 0;
  let older = 0;
  for (const age of input.childAges) {
    if (age < p.childFreeBelow) small += 1;
    else if (age < p.childAdultFrom) child += 1;
    else older += 1;
  }
  const extraAdults = Math.max(0, input.adults + older - standard.adults);
  const extraChildren = Math.max(0, small + child - standard.children);
  const chargeableChildren = Math.min(extraChildren, child);
  if (extraChildren > chargeableChildren) warnings.add('over_standard');

  const surcharges: QuoteLineSurcharge[] = [];
  const addSurcharge = (
    kind: QuoteLineSurcharge['kind'],
    persons: number,
    price: { sell: number; cost: number } | null,
  ) => {
    if (persons <= 0) return;
    if (!price) {
      warnings.add('over_standard');
      return;
    }
    const n = nights.length;
    surcharges.push({
      kind,
      persons,
      nights: n,
      sell: persons * n * price.sell,
      cost: persons * n * price.cost,
    });
  };
  addSurcharge('extra_adult', extraAdults, p.surcharges.extraAdult);
  addSurcharge('extra_child', chargeableChildren, p.surcharges.extraChild);

  if (p.maxGuests !== null && input.adults + input.childAges.length > p.maxGuests) {
    warnings.add('over_max');
  }

  const missing = warnings.has('missing_rate');
  const sum = (key: 'sell' | 'cost') =>
    nightLines.reduce((s, l) => s + l[key], 0) + surcharges.reduce((s, l) => s + l[key], 0);
  return {
    nights: nightLines,
    surcharges,
    totalSell: missing ? null : sum('sell'),
    totalCost: missing ? null : sum('cost'),
    warnings: WARNING_ORDER.filter((w) => warnings.has(w)),
  };
}
