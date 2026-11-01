import type { BookingDto, QuoteDto } from '@agent-sales/contracts';

import type { LodgingEventType } from '../api/lodging.events.js';
import { LodgingError } from '../domain/lodging.errors.js';
import type { Quote } from '../domain/quote.js';
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
      { warnings: quote.warnings },
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

/** What an edit may change about a stay: its dates, units and party. */
export interface StayShape {
  checkIn: string;
  checkOut: string;
  unitIds: string[];
  adults: number;
  childAges: number[];
}

const sameList = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The manual price an edited stay is saved with. `requested` is the request's `manualTotalSell`
 * (undefined = not sent, null = use the quote). A stay saved with a manual price that changes its
 * dates, units or party must say which price applies: the old manual price was agreed for the old
 * stay. A checked-in stay sends no price and keeps its manual total when the check-out moves.
 */
export function manualTotalForEdit(
  b: BookingRecord,
  next: StayShape,
  requested: number | null | undefined,
  inHouse: boolean,
): number | null {
  if (requested !== undefined) return requested;
  const stored = storedManualTotal(b);
  if (stored === null || inHouse) return stored;
  const changed =
    next.checkIn !== b.checkIn ||
    next.checkOut !== b.checkOut ||
    next.adults !== b.adults ||
    !sameList([...next.unitIds].sort(), [...b.unitIds].sort()) ||
    !sameList(next.childAges, b.childAges);
  if (changed) {
    throw new LodgingError(
      'VALIDATION_FAILED',
      'The stay has a manual price; enter a price or use the automatic price',
      { field: 'manualTotalSell' },
    );
  }
  return stored;
}
