import type { BookingListQuery, Policies } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

import type { Quote } from '../../domain/quote.js';
import type { RateRule } from '../../domain/rates.js';

export interface PropertyRecord {
  id: string;
  code: string;
  name: string;
  area: string;
  address: string;
  description: string;
  sellMode: 'whole' | 'rooms';
  status: 'active' | 'paused';
  standardAdults: number;
  standardChildren: number;
  maxGuests: number | null;
  childFreeBelow: number;
  childAdultFrom: number;
  amenities: string[];
  layout: { name: string; beds: string; note: string }[];
  policies: Policies;
  gallery: { url: string; caption: string }[];
  surcharges: {
    extraAdult: { sell: number; cost: number } | null;
    extraChild: { sell: number; cost: number } | null;
  };
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface UnitRecord {
  id: string;
  propertyId: string;
  kind: 'whole' | 'room';
  name: string;
  beds: string;
  capacityAdults: number;
  capacityChildren: number;
  active: boolean;
  sortOrder: number;
}

/** Every `BookingDto` field except the joined `propertyCode` / `propertyName` / `unitNames`. */
export interface BookingRecord {
  id: string;
  code: string;
  propertyId: string;
  kind: 'stay' | 'block';
  whole: boolean;
  unitIds: string[];
  status: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  childAges: number[];
  guestName: string;
  guestPhone: string;
  contactId: string | null;
  conversationId: string | null;
  source: string | null;
  holdExpiresAt: string | null;
  quote: Quote | null;
  adjustment: number;
  adjustmentReason: string;
  totalSell: number | null;
  totalCost: number | null;
  note: string;
  blockReason: string;
  clientRequestId: string;
  fingerprint: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TakenNight {
  unitId: string;
  night: string;
  bookingId: string;
  code: string;
}

export interface BookingHistoryRecord {
  at: string;
  actorName: string | null;
  action: string;
  data: Record<string, unknown>;
}

/** Everything lodging persists, inside one tenant transaction (RLS scoped to the workspace). */
export interface LodgingTx {
  properties(filter?: { ids?: string[]; activeOnly?: boolean }): Promise<PropertyRecord[]>;
  property(id: string, lock?: boolean): Promise<PropertyRecord | null>;
  insertProperty(p: PropertyRecord): Promise<void>;
  /** The caller bumps `version`. */
  updateProperty(p: PropertyRecord): Promise<void>;
  units(propertyIds: string[]): Promise<UnitRecord[]>;
  /** Upserts by id and deletes missing units; a deleted unit holding nights → CONFLICT. */
  replaceUnits(propertyId: string, units: UnitRecord[]): Promise<void>;
  rates(propertyIds: string[]): Promise<RateRule[]>;
  /** Replaces the weekday rules only; overrides stay. */
  replaceWeekdayRates(propertyId: string, rules: RateRule[]): Promise<void>;
  insertOverride(propertyId: string, r: RateRule): Promise<void>;
  updateOverride(propertyId: string, r: RateRule): Promise<void>;
  deleteOverride(propertyId: string, rateId: string): Promise<boolean>;
  settings(): Promise<{ holdMinutes: number }>;
  updateSettings(s: { holdMinutes: number }): Promise<void>;
  /** Next 'BK-0001' style code from the workspace sequence. */
  nextBookingCode(): Promise<string>;
  /** Transaction-scoped advisory lock serializing one idempotency key. */
  lockRequestKey(key: string): Promise<void>;
  findBooking(id: string, lock?: boolean): Promise<BookingRecord | null>;
  findBookingByRequest(clientRequestId: string): Promise<BookingRecord | null>;
  /** One page of 100 rows plus one probe row (101 max). */
  listBookings(q: BookingListQuery & { today: string }): Promise<BookingRecord[]>;
  /** Bookings in occupying statuses overlapping the nights [from, to). */
  bookingsInRange(propertyIds: string[], from: string, to: string): Promise<BookingRecord[]>;
  /** Inserts the booking and its `unitIds` rows. */
  insertBooking(b: BookingRecord): Promise<void>;
  /** Updates the booking and replaces its `unitIds` rows. */
  updateBooking(b: BookingRecord): Promise<void>;
  /** Occupies unit-nights; any already taken → LodgingError NIGHTS_TAKEN `{ codes }`. */
  takeNights(bookingId: string, unitIds: string[], nights: string[]): Promise<void>;
  releaseNights(bookingId: string): Promise<void>;
  /** Taken unit-nights in [from, to), ordered by unit then night. */
  takenNights(unitIds: string[], from: string, to: string): Promise<TakenNight[]>;
  /** Holds expired at `now` → status `expired` (version + 1), nights freed; returns them. */
  expireOverdueHolds(now: Date): Promise<BookingRecord[]>;
  /** null = no rows for this bot (= every active property). */
  botPropertyIds(botId: string): Promise<string[] | null>;
  setBotProperties(botId: string, propertyIds: string[]): Promise<void>;
  /** Audit trail of one booking, oldest first. */
  history(bookingId: string): Promise<BookingHistoryRecord[]>;
  audit(
    actorId: string | null,
    targetType: 'lodging_property' | 'lodging_booking',
    id: string,
    action: string,
    data: Record<string, unknown>,
  ): Promise<void>;
  /** Integration event to the outbox in the same transaction; `payload.bookingId` is the aggregate. */
  publish(event: { name: string; payload: Record<string, unknown> }): Promise<void>;
}

export interface LodgingStore {
  run<T>(ws: WorkspaceId, fn: (tx: LodgingTx) => Promise<T>): Promise<T>;
}

export const LODGING_STORE = Symbol('LODGING_STORE');
