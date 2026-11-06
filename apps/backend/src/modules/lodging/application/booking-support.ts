import {
  type BookingDto,
  normalizeBookingTags,
  type QuoteDto,
  type UpdateBookingRequest,
} from '@agent-sales/contracts';

import type { LodgingEventType } from '../api/lodging.events.js';
import { LodgingError } from '../domain/lodging.errors.js';
import { addNights, localToday, nightsBetween } from '../domain/nights.js';
import { quoteStay, type Quote, type QuoteInput } from '../domain/quote.js';
import type { RateRule } from '../domain/rates.js';
import type {
  BookingRecord,
  LodgingTx,
  PackageRecord,
  PropertyRecord,
  UnitRecord,
} from './ports/lodging-store.js';

/**
 * Who did it: the user id for the audit row and their display name for the history. A bot has
 * no user id (`null`) and its name as the display name.
 */
export interface Actor {
  id: string | null;
  name: string | null;
}

/** A property with every unit (both modes, active or not), its price rules and packages. */
export interface PropertyContext {
  property: PropertyRecord;
  units: UnitRecord[];
  rates: RateRule[];
  packages: PackageRecord[];
}

/** Status events carry ids and codes only, never guest details. */
export async function publishStatus(
  tx: LodgingTx,
  name: LodgingEventType,
  b: Pick<BookingRecord, 'id' | 'code' | 'propertyId'>,
): Promise<void> {
  await tx.publish({ name, payload: { bookingId: b.id, code: b.code, propertyId: b.propertyId } });
}

/**
 * Lazy hold expiry: every lodging transaction runs this first, so nobody can see or be blocked by
 * an overdue hold. Each expired hold gets a history row and `lodging.booking.expired.v1`.
 */
export async function expireHolds(tx: LodgingTx, now: Date): Promise<BookingRecord[]> {
  const expired = await tx.expireOverdueHolds(now);
  for (const b of expired) {
    await tx.audit(null, 'lodging_booking', b.id, 'lodging.booking.expired', {
      holdExpiresAt: b.holdExpiresAt,
    });
    await publishStatus(tx, 'lodging.booking.expired.v1', b);
  }
  return expired;
}

export async function loadContext(tx: LodgingTx, propertyId: string): Promise<PropertyContext> {
  const property = await tx.property(propertyId);
  if (!property) throw new LodgingError('NOT_FOUND', 'Property not found');
  return {
    property,
    units: await tx.units([property.id]),
    rates: await tx.rates([property.id]),
    packages: await tx.packages([property.id]),
  };
}

export function toQuoteDto(q: Quote, takenBy: string[] = []): QuoteDto {
  return { ...q, takenBy };
}

/**
 * The package each booked unit is sold with, from the quote's chosen packages: a room's own
 * package; for a whole rental the whole-property package first (every row gets it), else the
 * room's own.
 */
export function unitPackagesOf(
  quote: Quote | null,
  whole: boolean,
  unitIds: string[],
): Record<string, string> {
  const chosen = quote?.packages ?? [];
  const wholePackage = whole ? chosen.find((c) => c.target === null) : undefined;
  const out: Record<string, string> = {};
  for (const unitId of unitIds) {
    const pk = wholePackage ?? chosen.find((c) => c.target === unitId);
    if (pk) out[unitId] = pk.packageId;
  }
  return out;
}

/**
 * Quote of a stay keeping the packages it was sold with, while they still fit: when they no
 * longer belong to the selection, leave a night unpriced (`package_unavailable`) or hold too few
 * guests (`over_max`), the packages are picked automatically. The booking does not remember
 * whether staff chose its package or the quote did, so a kept package never blocks an edit.
 */
export function quoteKeepingPackages(
  ctx: PropertyContext,
  input: Omit<QuoteInput, 'packageIds'>,
  stored: string[],
): Quote {
  const quote = (packageIds: string[]) =>
    quoteStay(ctx.property, ctx.units, ctx.rates, { ...input, packageIds }, ctx.packages);
  if (stored.length === 0) return quote([]);
  let kept: Quote;
  try {
    kept = quote(stored);
  } catch (error) {
    if (error instanceof LodgingError && error.code === 'VALIDATION_FAILED') return quote([]);
    throw error;
  }
  const misfit =
    kept.warnings.includes('package_unavailable') || kept.warnings.includes('over_max');
  return misfit ? quote([]) : kept;
}

/** Quote of a stay with the `requested` packages when sent, else `quoteKeepingPackages(kept)`. */
export function quoteSelection(
  ctx: PropertyContext,
  input: Omit<QuoteInput, 'packageIds'>,
  requested: string[] | undefined,
  kept: string[],
): Quote {
  if (requested === undefined) return quoteKeepingPackages(ctx, input, kept);
  const withPackages = { ...input, packageIds: requested };
  return quoteStay(ctx.property, ctx.units, ctx.rates, withPackages, ctx.packages);
}

/** The booking's packages, once each, in the order of its units. */
export function bookingPackageIds(b: Pick<BookingRecord, 'unitIds' | 'unitPackages'>): string[] {
  return [...new Set(b.unitIds.flatMap((id) => b.unitPackages[id] ?? []))];
}

/** API shape of a booking; property, unit and package names come from the given lookups. */
export function toBookingDto(
  b: BookingRecord,
  properties: Map<string, PropertyRecord>,
  units: Map<string, UnitRecord>,
  packages: Map<string, PackageRecord> = new Map(),
): BookingDto {
  const packageIds = bookingPackageIds(b);
  const {
    unitPackages: _packages,
    clientRequestId: _key,
    fingerprint: _fp,
    reviewedBy: _reviewer,
    adults,
    childAges,
    quote,
    status,
    source,
    ...rest
  } = b;
  const p = properties.get(b.propertyId);
  return {
    ...rest,
    status: status as BookingDto['status'],
    source: source as BookingDto['source'],
    propertyCode: p?.code ?? '',
    propertyName: p?.name ?? '',
    unitNames: b.unitIds.map((id) => units.get(id)?.name ?? ''),
    packageIds,
    packageNames: packageIds.map((id) => packages.get(id)?.name ?? ''),
    party: { adults, childAges },
    quote: quote ? toQuoteDto(quote) : null,
  };
}

/** Bookings as DTOs with their property and unit names loaded in two queries. */
export async function toBookingDtos(tx: LodgingTx, list: BookingRecord[]): Promise<BookingDto[]> {
  const pids = [...new Set(list.map((b) => b.propertyId))];
  if (pids.length === 0) return [];
  const props = new Map((await tx.properties({ ids: pids })).map((p) => [p.id, p]));
  const units = new Map((await tx.units(pids)).map((u) => [u.id, u]));
  const packages = new Map((await tx.packages(pids)).map((pk) => [pk.id, pk]));
  return list.map((b) => toBookingDto(b, props, units, packages));
}

/**
 * Sell total of a stay: the manual price when given, else the quote's, plus the adjustment.
 * A stay without a price for every night needs a manual price.
 */
export function totals(
  quote: Quote,
  manualTotalSell: number | null,
  adjustment: number,
): { totalSell: number | null; totalCost: number | null } {
  const base = manualTotalSell ?? quote.totalSell;
  if (base === null) {
    throw new LodgingError(
      'VALIDATION_FAILED',
      'Some nights have no price; enter a price for the stay',
      { field: 'manualTotalSell', warnings: quote.warnings },
    );
  }
  const totalSell = base + adjustment;
  if (totalSell < 0) {
    throw new LodgingError('VALIDATION_FAILED', 'The adjustment makes the total negative');
  }
  return { totalSell, totalCost: quote.totalCost };
}

/** The manual price a stored stay was saved with (null when it followed its quote). */
export function storedManualTotal(b: BookingRecord): number | null {
  if (b.totalSell === null) return null;
  const base = b.totalSell - b.adjustment;
  return b.quote?.totalSell === base ? null : base;
}

/** Same members, any order (duplicates ignored). */
export function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * The manual price a stay whose dates, units or party changed is saved with. `requested` is the
 * request's `manualTotalSell` (undefined = not sent, null = use the quote). A stay saved with a
 * manual price must say which price applies (checked-in stays too): the old manual price was
 * agreed for the old stay.
 */
export function manualTotalForEdit(
  b: BookingRecord,
  requested: number | null | undefined,
): number | null {
  if (requested !== undefined) return requested;
  if (storedManualTotal(b) === null) return null;
  throw new LodgingError(
    'VALIDATION_FAILED',
    'The stay has a manual price; enter a price or use the automatic price',
    { field: 'manualTotalSell' },
  );
}

/**
 * Totals of an edit that keeps the dates, units and party: the stored base (manual price or the
 * stored quote's total) plus the new adjustment; a requested manual price still overrides it.
 * Without a stored quote (migrated stays) the stored total and cost are kept as the base.
 */
export function keptTotals(
  b: BookingRecord,
  requested: number | null | undefined,
  adjustment: number,
): { totalSell: number | null; totalCost: number | null } {
  const stored = b.totalSell === null ? null : b.totalSell - b.adjustment;
  if (!b.quote) {
    // Stays copied from T-155 stay requests (migration 0041) have no stored quote.
    const base = requested ?? stored;
    if (base === null) return { totalSell: null, totalCost: b.totalCost };
    if (base + adjustment < 0) {
      throw new LodgingError('VALIDATION_FAILED', 'The adjustment makes the total negative');
    }
    return { totalSell: base + adjustment, totalCost: b.totalCost };
  }
  return totals(b.quote, requested !== undefined ? requested : stored, adjustment);
}

/**
 * Early check-out: a guest leaving before the booked check-out keeps the nights up to
 * max(check-in + 1, today); later nights go back to the calendar. An automatic price is
 * re-quoted for the shorter stay (kept when a night has no price); a manual price stays.
 * Returns null when the guest leaves on (or after) the booked check-out.
 */
export async function shortenStay(
  tx: LodgingTx,
  b: BookingRecord,
  now: Date,
): Promise<BookingRecord | null> {
  const today = localToday(now);
  const minOut = addNights(b.checkIn, 1);
  const checkOut = today > minOut ? today : minOut;
  if (checkOut >= b.checkOut) return null;
  await tx.releaseNights(b.id);
  await tx.takeNights(b.id, b.unitIds, nightsBetween(b.checkIn, checkOut));
  let next: BookingRecord = { ...b, checkOut };
  if (b.kind === 'stay' && storedManualTotal(b) === null) {
    const ctx = await loadContext(tx, b.propertyId);
    const quote = quoteKeepingPackages(
      ctx,
      {
        whole: b.whole,
        unitIds: b.unitIds,
        checkIn: b.checkIn,
        checkOut,
        adults: b.adults,
        childAges: b.childAges,
      },
      bookingPackageIds(b),
    );
    if (quote.totalSell !== null) {
      next = {
        ...next,
        quote,
        unitPackages: unitPackagesOf(quote, b.whole, b.unitIds),
        totalSell: Math.max(0, quote.totalSell + b.adjustment),
        totalCost: quote.totalCost,
      };
    }
  }
  return next;
}

/** Fields a checked-in stay may still change: its check-out, its price and its tags. */
const IN_HOUSE_FIELDS = new Set([
  'version',
  'checkOut',
  'manualTotalSell',
  'adjustment',
  'adjustmentReason',
  'tags',
]);
/** Fields that make no sense on a block. */
const STAY_ONLY_FIELDS = [
  'party',
  'guestName',
  'guestPhone',
  'adjustment',
  'adjustmentReason',
  'manualTotalSell',
  'tags',
] as const;

/** NFC-normalised, trimmed tags without empties or duplicates, first occurrence first. */
export function normalizeTags(tags: readonly string[]): string[] {
  return normalizeBookingTags(tags);
}

/** Which bookings an edit may touch, and which fields (409 / 400 otherwise). */
export function assertEditable(b: BookingRecord, req: UpdateBookingRequest): void {
  const inHouse = b.status === 'checked_in';
  if (inHouse) {
    const others = Object.keys(req).filter(
      (k) => !IN_HOUSE_FIELDS.has(k) && req[k as keyof UpdateBookingRequest] !== undefined,
    );
    if (others.length > 0) {
      throw new LodgingError(
        'CONFLICT',
        'A checked-in stay can only change its check-out, price and tags',
        {
          fields: others,
        },
      );
    }
  } else if (!['hold', 'confirmed', 'active'].includes(b.status)) {
    throw new LodgingError('CONFLICT', `A ${b.status} booking cannot be edited`);
  }
  if (b.kind === 'block' && STAY_ONLY_FIELDS.some((k) => req[k] !== undefined)) {
    throw new LodgingError('VALIDATION_FAILED', 'A block has no guest, party or price');
  }
}

/** Fields every new booking gets, stay or block (a block sells no package). */
export type BookingBase = Pick<
  BookingRecord,
  | 'id'
  | 'code'
  | 'propertyId'
  | 'whole'
  | 'unitIds'
  | 'checkIn'
  | 'checkOut'
  | 'clientRequestId'
  | 'fingerprint'
  | 'reviewedAt'
  | 'reviewedBy'
  | 'version'
  | 'createdAt'
  | 'updatedAt'
>;

/** A new block: no guest, party or price. */
export function blockRecord(base: BookingBase, blockReason: string): BookingRecord {
  return {
    ...base,
    unitPackages: {},
    kind: 'block',
    status: 'active',
    adults: 0,
    childAges: [],
    guestName: '',
    guestPhone: '',
    contactId: null,
    conversationId: null,
    source: null,
    holdExpiresAt: null,
    quote: null,
    adjustment: 0,
    adjustmentReason: '',
    totalSell: null,
    totalCost: null,
    note: '',
    tags: [],
    blockReason,
  };
}

/** The first staff status action or edit of a bot booking reviews it (T-161); a bot never does. */
export function reviewedBy(
  b: BookingRecord,
  actor: Actor,
  now: Date,
): Pick<BookingRecord, 'reviewedAt' | 'reviewedBy'> {
  if (b.source !== 'bot' || b.reviewedAt !== null || actor.id === null) {
    return { reviewedAt: b.reviewedAt, reviewedBy: b.reviewedBy };
  }
  return { reviewedAt: now.toISOString(), reviewedBy: actor.id };
}
