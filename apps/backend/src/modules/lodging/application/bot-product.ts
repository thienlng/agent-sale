import {
  type AccommodationDetails,
  galleryCoverUrl,
  type ProductDto,
} from '@agent-sales/contracts';

import { fullPackage, packagesOf, type DomainPackage, type RateRule } from '../domain/rates.js';
import type { PropertyRecord, UnitRecord } from './ports/lodging-store.js';
import { currentUnits } from './property-support.js';

/** Limits of the bot view (the product image list and the `AccommodationDetails` schema). */
const MAX_IMAGE_URLS = 5;
const MAX_GALLERY = 30;
const MAX_ALBUMS = 20;
const MAX_AMENITIES = 50;
const MAX_OVERRIDES = 20;
const MAX_NOTES = 3000;
/** The model reads an unknown field as "(not provided)" (prompt rule). */
const NOT_PROVIDED = '(not provided)';

type WeekdayRow = { days: number[]; amount: number };

/**
 * Weekday rules of one target (null = whole property) as `{days, amount}` rows, sell prices only;
 * a target with packages shows its full package's prices.
 */
function weekdayRows(
  rules: RateRule[],
  unitId: string | null,
  packages: DomainPackage[],
): WeekdayRow[] {
  const packageId = fullPackage(packages, unitId)?.id ?? null;
  return rules
    .filter(
      (r) =>
        r.kind === 'weekday' &&
        r.unitId === unitId &&
        r.packageId === packageId &&
        r.weekdays.length,
    )
    .map((r) => ({ days: [...r.weekdays].sort((a, b) => a - b), amount: r.sell }))
    .sort((a, b) => (a.days[0] ?? 0) - (b.days[0] ?? 0));
}

type BotPackage = NonNullable<AccommodationDetails['packages']>[number];

/**
 * The packages of one target, fewest bedrooms first, with their weekday sell prices (index 0 =
 * Monday; null = not sold that weekday). Undefined when the target has none.
 */
function packageRows(
  rules: RateRule[],
  target: string | null,
  packages: DomainPackage[],
): BotPackage[] | undefined {
  const own = packagesOf(packages, target);
  if (!own.length) return undefined;
  return [...own]
    .sort((a, b) => a.bedrooms - b.bedrooms)
    .map((pk) => ({
      name: pk.name,
      bedrooms: pk.bedrooms,
      standardAdults: pk.standardAdults,
      standardChildren: pk.standardChildren,
      maxGuests: pk.maxGuests,
      weekdaySell: [1, 2, 3, 4, 5, 6, 7].map(
        (day) =>
          rules.find(
            (r) =>
              r.kind === 'weekday' &&
              r.unitId === target &&
              r.packageId === pk.id &&
              r.weekdays.includes(day),
          )?.sell ?? null,
      ),
    }));
}

/** A folder list as the bot reads it: at most 20 folders, captions trimmed. */
const toAlbums = (gallery: PropertyRecord['gallery']) =>
  gallery.slice(0, MAX_ALBUMS).map((f) => ({
    id: f.id,
    name: f.name,
    items: f.items.map((i) => ({ ...i, caption: i.caption.trim().slice(0, 300) })),
  }));

/** One bookable room of a `rooms` property with its details, folders and packages (T-193). */
function botUnit(unit: UnitRecord, rows: WeekdayRow[], rules: RateRule[], pkgs: DomainPackage[]) {
  const albums = toAlbums(unit.gallery);
  const packages = packageRows(rules, unit.id, pkgs);
  return {
    name: unit.name,
    beds: unit.beds,
    capacityAdults: unit.capacityAdults,
    capacityChildren: unit.capacityChildren,
    weekdayRates: rows,
    category: unit.category,
    view: unit.view.trim(),
    areaM2: unit.areaM2,
    description: unit.description.trim(),
    amenities: unit.amenities.slice(0, MAX_AMENITIES),
    maxGuests: unit.maxGuests,
    ...(albums.length ? { albums } : {}),
    ...(packages ? { packages } : {}),
  };
}

/** Every ISO weekday 1..7 priced exactly once. */
function coversWeek(rows: WeekdayRow[]): boolean {
  const days = rows.flatMap((r) => r.days);
  return days.length === 7 && new Set(days).size === 7 && days.every((d) => d >= 1 && d <= 7);
}

/** Per ISO weekday the sum of every room's price, equal amounts grouped into one row. */
function summedRows(roomRows: WeekdayRow[][]): WeekdayRow[] {
  const byAmount = new Map<number, number[]>();
  for (let day = 1; day <= 7; day += 1) {
    const amount = roomRows.reduce(
      (sum, rows) => sum + (rows.find((r) => r.days.includes(day))?.amount ?? 0),
      0,
    );
    byAmount.set(amount, [...(byAmount.get(amount) ?? []), day]);
  }
  return [...byAmount]
    .map(([amount, days]) => ({ days, amount }))
    .sort((a, b) => (a.days[0] ?? 0) - (b.days[0] ?? 0));
}

/** An override's label with its minimum stay, so the model can tell the customer. */
const overrideLabel = (label: string, minNights: number | null): string =>
  minNights && minNights > 1
    ? [label.trim(), `(min ${minNights} nights)`].filter(Boolean).join(' ')
    : label;

/**
 * The bot view of one property as a `ProductDto` (`id` = property id) whose `accommodation` holds
 * the per-night weekday rates, the rooms of a `rooms` property, upcoming date-range prices (from
 * `today`, at most 20) and the surcharges. Sell prices only: no cost ever leaves this function.
 * `rates` are this property's rules; `units` may hold other properties' units too.
 * `albums` carries the media folders (photos, videos, links) for the bot's album and video ids;
 * `gallery` is their photos flattened. Each room also carries its details and own folders; a
 * target with bedroom packages lists them (`packages`, sell prices per weekday) (T-193).
 * Returns null when the property cannot be quoted (some weekday has no price).
 */
export function toBotProduct(
  p: PropertyRecord,
  units: UnitRecord[],
  rates: RateRule[],
  today: string,
  packages: DomainPackage[] = [],
): ProductDto | null {
  const rooms =
    p.sellMode === 'rooms'
      ? currentUnits(p, units).filter((u) => u.active && u.kind === 'room')
      : [];
  const roomRows = rooms.map((u) => ({ unit: u, rows: weekdayRows(rates, u.id, packages) }));
  const priced = roomRows.filter((r) => coversWeek(r.rows));

  const wholeRows = weekdayRows(rates, null, packages);
  // Without whole-place weekday rules, renting the whole place costs the sum of its active rooms
  // per night (as `quoteStay` prices it); a room without a price hides the property.
  const weekRates = coversWeek(wholeRows)
    ? wholeRows
    : rooms.length && priced.length === rooms.length
      ? summedRows(priced.map((r) => r.rows))
      : [];
  if (!coversWeek(weekRates)) return null;

  const wholePackages = packageRows(rates, null, packages);
  // "From" prices count every package sold (a smaller package is often the cheapest stay).
  const packageAmounts = [
    ...(wholePackages ?? []),
    ...priced.flatMap((r) => packageRows(rates, r.unit.id, packages) ?? []),
  ].flatMap((pk) => pk.weekdaySell.filter((v): v is number => v !== null));
  const amounts = [
    ...[...weekRates, ...priced.flatMap((r) => r.rows)].map((r) => r.amount),
    ...packageAmounts,
  ];
  const roomNames = new Map(rooms.map((u) => [u.id, u.name]));
  const packageNames = new Map(packages.map((pk) => [pk.id, pk.name]));
  const overrides = rates
    .filter(
      (r): r is RateRule & { dateFrom: string; dateTo: string } =>
        r.kind === 'override' &&
        r.dateFrom !== null &&
        r.dateTo !== null &&
        r.dateTo >= today &&
        (r.unitId === null || roomNames.has(r.unitId)),
    )
    .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))
    .slice(0, MAX_OVERRIDES)
    .map((r) => ({
      dateFrom: r.dateFrom,
      dateTo: r.dateTo,
      label: overrideLabel(r.label, r.minNights),
      amount: r.sell,
      unitName: r.unitId === null ? null : (roomNames.get(r.unitId) ?? null),
      ...(r.packageId && packageNames.has(r.packageId)
        ? { packageName: packageNames.get(r.packageId) }
        : {}),
    }));

  const layout =
    p.sellMode === 'rooms'
      ? rooms.map((u) => ({ name: u.name, beds: u.beds }))
      : p.layout.map((l) => ({ name: l.name, beds: l.beds }));
  const roomLayout = (layout.length ? layout : [{ name: p.name, beds: '' }]).map((l) => ({
    name: l.name.slice(0, 100),
    beds: l.beds.trim().slice(0, 500) || NOT_PROVIDED,
  }));
  const albums = toAlbums(p.gallery);
  // The flat photo list older readers know: every folder's photos in order, captioned by the
  // folder name when the owner left the caption empty (the image allowlist needs a label).
  const gallery = p.gallery
    .flatMap((f) =>
      f.items
        .filter((i) => i.kind === 'image')
        .map((i) => ({
          url: i.url,
          caption: i.caption.trim().slice(0, 300) || f.name.slice(0, 300),
        })),
    )
    .slice(0, MAX_GALLERY)
    .map((g, i) => ({ url: g.url, caption: g.caption || `${p.code} photo ${i + 1}` }));
  const cover = galleryCoverUrl(p);
  const imageUrls = [...new Set([...(cover ? [cover] : []), ...gallery.map((g) => g.url)])].slice(
    0,
    MAX_IMAGE_URLS,
  );
  const { checkInTime, checkOutTime, deposit, cancellation, houseRules, other } = p.policies;

  const accommodation: AccommodationDetails = {
    rentalType: p.sellMode === 'rooms' ? 'rooms' : 'entire_property',
    code: p.code,
    bedrooms: Math.max(1, roomLayout.length),
    standardAdults: p.standardAdults,
    standardChildren: p.standardChildren,
    childAgeBelow: Math.max(1, p.childFreeBelow || p.childAdultFrom),
    maxGuests: p.maxGuests,
    roomLayout,
    amenities: p.amenities.slice(0, MAX_AMENITIES),
    rateBasis: 'night',
    rates: weekRates,
    checkInOut: [checkInTime.trim(), checkOutTime.trim()].filter(Boolean).join(' / '),
    depositPolicy: deposit.slice(0, 1000),
    cancellationPolicy: cancellation.slice(0, 1000),
    extraGuestPolicy: '',
    holidayPolicy: '',
    gallery,
    ...(albums.length ? { albums } : {}),
    notes: [p.address.trim() ? `Address: ${p.address.trim()}` : '', houseRules, other]
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, MAX_NOTES),
    ...(p.sellMode === 'rooms'
      ? {
          units: priced.map(({ unit, rows }) => botUnit(unit, rows, rates, packages)),
        }
      : {}),
    ...(wholePackages ? { packages: wholePackages } : {}),
    ...(overrides.length ? { overrides } : {}),
    surcharges: {
      extraAdult: p.surcharges.extraAdult?.sell ?? null,
      extraChild: p.surcharges.extraChild?.sell ?? null,
      childFreeBelow: p.childFreeBelow,
      childAdultFrom: p.childAdultFrom,
    },
  };

  return {
    id: p.id,
    code: p.code,
    name: `${p.code} – ${p.name}`,
    description: p.description,
    category: p.area.trim() || null,
    status: 'active',
    visibleToBot: true,
    botInstructions: '',
    imageUrls,
    accommodation,
    offering: null,
    // Lodging places are Rapiz-owned; they never come from a PMS.
    external: null,
    variants: [],
    priceMin: Math.min(...amounts),
    priceMax: Math.max(...amounts),
    available: 0,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
