import { LodgingError } from './lodging.errors.js';
import { isoWeekday, nightsBetween } from './nights.js';
import {
  fullPackage,
  packagesOf,
  priceNight,
  type DomainPackage,
  type NightPrice,
  type RateRule,
} from './rates.js';

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
  /** Hard maximum of the unit; missing or null = none. */
  maxGuests?: number | null;
}

export interface QuoteInput {
  whole: boolean;
  unitIds: string[];
  checkIn: string;
  checkOut: string;
  adults: number;
  childAges: number[];
  /** Packages chosen by hand, at most one per priced target; missing = none. */
  packageIds?: string[];
}

export type QuoteWarning =
  | 'min_nights'
  | 'missing_rate'
  | 'over_max'
  | 'over_standard'
  | 'child_ages_missing'
  | 'package_unavailable';

/** A package the quote used; `target` null = the whole property. */
export interface QuotePackage {
  target: string | null;
  packageId: string;
  name: string;
}

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
  packages: QuotePackage[];
}

const WARNING_ORDER: readonly QuoteWarning[] = [
  'min_nights',
  'missing_rate',
  'over_max',
  'over_standard',
  'child_ages_missing',
  'package_unavailable',
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

/**
 * The package of each priced target that has packages: the explicit one from `packageIds`,
 * else auto. Auto looks at the party only when the selection prices a single target: the
 * fewest bedrooms whose maximum (else its standard party) holds the party and that prices
 * every night; otherwise, and when none fits, the full package.
 */
function choosePackages(
  rules: RateRule[],
  packages: DomainPackage[],
  targets: (string | null)[],
  nightsOf: (target: string | null) => string[],
  packageIds: string[],
  party: number,
): { chosen: Map<string | null, DomainPackage>; explicit: Set<string> } {
  const chosen = new Map<string | null, DomainPackage>();
  const explicit = new Set<string>();
  for (const id of new Set(packageIds)) {
    const p = packages.find((x) => x.id === id);
    if (!p || !targets.includes(p.unitId)) {
      throw new LodgingError('VALIDATION_FAILED', 'Unknown package for this selection', {
        packageId: id,
      });
    }
    if (chosen.has(p.unitId)) {
      throw new LodgingError('VALIDATION_FAILED', 'One package per target', {
        unitId: p.unitId,
      });
    }
    chosen.set(p.unitId, p);
    explicit.add(p.id);
  }
  const byParty = targets.length === 1;
  for (const t of targets) {
    if (chosen.has(t)) continue;
    const full = fullPackage(packages, t);
    if (!full) continue;
    const fit = byParty
      ? packagesOf(packages, t)
          .filter((p) => (p.maxGuests ?? p.standardAdults + p.standardChildren) >= party)
          .filter((p) => nightsOf(t).every((n) => priceNight(rules, t, n, p.id) !== null))
          .sort((a, b) => a.bedrooms - b.bedrooms)[0]
      : undefined;
    chosen.set(t, fit ?? full);
  }
  return { chosen, explicit };
}

/**
 * Prices a stay from rules (override wins, else weekday) plus per-person surcharges. A target
 * with bedroom packages is priced with its chosen package (see `choosePackages`).
 */
export function quoteStay(
  p: QuoteProperty,
  units: QuoteUnit[],
  rules: RateRule[],
  input: QuoteInput,
  packages: DomainPackage[] = [],
): Quote {
  const nights = nightsBetween(input.checkIn, input.checkOut);
  const unitIds = resolveUnits(p, units, input);
  const party = input.adults + input.childAges.length;
  const wholePackages = packagesOf(packages, null);
  /** A whole-target rate prices the night (package-less, or of any whole package). */
  const wholePriced = (night: string) =>
    priceNight(rules, null, night) !== null ||
    wholePackages.some((pk) => priceNight(rules, null, night, pk.id) !== null);
  /**
   * Targets priced for one night. Whole property: the whole target only. Whole rental of a
   * rooms property: a whole-target rate for that night if any (override, else weekday — see
   * `priceNight`), otherwise the sum of the active rooms. Room selection: the selected rooms.
   */
  const targetsFor = (night: string): (string | null)[] => {
    if (!input.whole) return unitIds;
    if (p.sellMode === 'whole') return [null];
    return wholePriced(night) ? [null] : unitIds;
  };
  const perNight = nights.map((date) => ({ date, targets: targetsFor(date) }));
  const priced: (string | null)[] = [];
  for (const n of perNight) for (const t of n.targets) if (!priced.includes(t)) priced.push(t);
  const { chosen, explicit } = choosePackages(
    rules,
    packages,
    priced,
    (t) => perNight.filter((n) => n.targets.includes(t)).map((n) => n.date),
    input.packageIds ?? [],
    party,
  );
  const warnings = new Set<QuoteWarning>();

  const nightLines = perNight.map(({ date, targets }): QuoteLineNight => {
    const line: QuoteLineNight = { date, weekday: isoWeekday(date), label: '', sell: 0, cost: 0 };
    const prices: NightPrice[] = [];
    for (const t of targets) {
      const pk = chosen.get(t);
      const price = priceNight(rules, t, date, pk?.id ?? null);
      if (!price) {
        warnings.add('missing_rate');
        if (pk && explicit.has(pk.id)) warnings.add('package_unavailable');
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
  const wholePackage = chosen.get(null);
  const [onlyUnit] = unitIds;
  const unitPackage =
    !input.whole && unitIds.length === 1 && onlyUnit ? chosen.get(onlyUnit) : undefined;
  const standardPackage = input.whole ? wholePackage : unitPackage;
  const standard = standardPackage
    ? { adults: standardPackage.standardAdults, children: standardPackage.standardChildren }
    : input.whole
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

  const limits: number[] = [];
  if (p.maxGuests !== null) limits.push(p.maxGuests);
  const [onlyTarget] = priced;
  const onePackage =
    priced.length === 1 && onlyTarget !== undefined ? chosen.get(onlyTarget) : undefined;
  if (onePackage) {
    if (onePackage.maxGuests !== null) limits.push(onePackage.maxGuests);
  } else if (selected.length > 0 && selected.every((u) => typeof u.maxGuests === 'number')) {
    limits.push(selected.reduce((s, u) => s + (u.maxGuests ?? 0), 0));
  }
  if (limits.some((max) => party > max)) warnings.add('over_max');

  const missing = warnings.has('missing_rate');
  const sum = (key: 'sell' | 'cost') =>
    nightLines.reduce((s, l) => s + l[key], 0) + surcharges.reduce((s, l) => s + l[key], 0);
  return {
    nights: nightLines,
    surcharges,
    totalSell: missing ? null : sum('sell'),
    totalCost: missing ? null : sum('cost'),
    warnings: WARNING_ORDER.filter((w) => warnings.has(w)),
    packages: priced.flatMap((target) => {
      const pk = chosen.get(target);
      return pk ? [{ target, packageId: pk.id, name: pk.name }] : [];
    }),
  };
}
