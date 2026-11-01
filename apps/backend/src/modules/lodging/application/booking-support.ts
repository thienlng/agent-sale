import {
  type BookingDto,
  normalizeBookingTags,
  type QuoteDto,
  type UpdateBookingRequest,
} from '@agent-sales/contracts';

import type { LodgingEventType } from '../api/lodging.events.js';
import { LodgingError } from '../domain/lodging.errors.js';
import { addNights, localToday, nightsBetween } from '../domain/nights.js';
import { quoteStay, type Quote } from '../domain/quote.js';
import type { RateRule } from '../domain/rates.js';
import type {
  BookingRecord,
  LodgingTx,
  PropertyRecord,
  UnitRecord,
} from './ports/lodging-store.js';

/** Who did it: the user id for the audit row and their display name for the history. */
export interface Actor {
  id: string;
  name: string | null;
}

/** A property with every unit (both modes, active or not) and its price rules. */
export interface PropertyContext {
  property: PropertyRecord;
  units: UnitRecord[];
  rates: RateRule[];
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
  };
}

export function toQuoteDto(q: Quote, takenBy: string[] = []): QuoteDto {
  return { ...q, takenBy };
}

/** API shape of a booking; property and unit names come from the given lookups. */
export function toBookingDto(
  b: BookingRecord,
  properties: Map<string, PropertyRecord>,
  units: Map<string, UnitRecord>,
): BookingDto {
  const {
    clientRequestId: _key,
    fingerprint: _fp,
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
  return list.map((b) => toBookingDto(b, props, units));
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
    const quote = quoteStay(ctx.property, ctx.units, ctx.rates, {
      whole: b.whole,
      unitIds: b.unitIds,
      checkIn: b.checkIn,
      checkOut,
      adults: b.adults,
      childAges: b.childAges,
    });
    if (quote.totalSell !== null) {
      next = {
        ...next,
        quote,
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
