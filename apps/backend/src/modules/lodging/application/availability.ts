import { quoteStay, resolveUnits, type Quote } from '../domain/quote.js';
import type { RateRule } from '../domain/rates.js';
import type { LodgingTx, PropertyRecord, UnitRecord } from './ports/lodging-store.js';
import { currentUnits } from './property-support.js';

export interface StayAsk {
  checkIn: string;
  checkOut: string;
  adults: number;
  childAges: number[];
}

/** One free selection with its quote (cost included: callers decide what leaves the module). */
export interface FreeOption {
  property: PropertyRecord;
  whole: boolean;
  unitIds: string[];
  /** Every unit of the property (both modes, active or not). */
  units: UnitRecord[];
  quote: Quote;
  /** Nobody above the standard capacity or the property's maximum. */
  fits: boolean;
}

/** `fits` = nobody above the standard capacity or the property's maximum. */
export const fitsQuote = (q: Quote): boolean =>
  !q.warnings.includes('over_max') && !q.warnings.includes('over_standard');

/** Largest rooms first until they hold `persons`; all of them when they never do. */
function pickRooms(free: UnitRecord[], persons: number): string[] {
  const size = (u: UnitRecord) => u.capacityAdults + u.capacityChildren;
  const picked: string[] = [];
  let room = 0;
  for (const u of [...free].sort((a, b) => size(b) - size(a))) {
    if (room >= persons && picked.length > 0) break;
    picked.push(u.id);
    room += size(u);
  }
  return picked;
}

/**
 * Free options of `props` for the nights (spec T-160 §4): the whole property, and for a rooms
 * property the free rooms (largest first until the party fits, or all free rooms when it does
 * not). Only options free on every night; unsorted. Reads the calendar inside `tx`; the caller
 * runs `expireHolds` first.
 */
export async function freeOptions(
  tx: LodgingTx,
  props: PropertyRecord[],
  stay: StayAsk,
  loaded?: { units: UnitRecord[]; ratesOf: Map<string, RateRule[]> },
): Promise<FreeOption[]> {
  const pids = props.map((p) => p.id);
  if (pids.length === 0) return [];
  const units = loaded?.units ?? (await tx.units(pids));
  const ratesOf = loaded?.ratesOf ?? (await tx.ratesByProperty(pids));
  const taken = new Set(
    (
      await tx.takenNights(
        units.map((u) => u.id),
        stay.checkIn,
        stay.checkOut,
      )
    ).map((t) => t.unitId),
  );
  const persons = stay.adults + stay.childAges.length;
  const options: FreeOption[] = [];
  for (const p of props) {
    const own = units.filter((u) => u.propertyId === p.id);
    const rates = ratesOf.get(p.id) ?? [];
    const selections: { whole: boolean; unitIds: string[] }[] = [];
    const bookable = currentUnits(p, own).filter((u) => u.active);
    const wholeFree = bookable.length > 0 && bookable.every((u) => !taken.has(u.id));
    if (wholeFree) selections.push({ whole: true, unitIds: [] });
    if (p.sellMode === 'rooms') {
      const free = bookable.filter((u) => !taken.has(u.id));
      const rooms = free.length > 0 ? pickRooms(free, persons) : [];
      // Every room of a free property is the whole rental already offered above.
      const sameAsWhole = wholeFree && rooms.length === bookable.length;
      if (rooms.length > 0 && !sameAsWhole) selections.push({ whole: false, unitIds: rooms });
    }
    for (const s of selections) {
      const quote = quoteStay(p, own, rates, { ...s, ...stay });
      options.push({
        property: p,
        whole: s.whole,
        unitIds: resolveUnits(p, own, s),
        units: own,
        quote,
        fits: fitsQuote(quote),
      });
    }
  }
  return options;
}
