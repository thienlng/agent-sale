import type {
  BookingListQuery,
  GalleryFolder,
  Policies,
  UnitCategory,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

import type { Quote } from '../../domain/quote.js';
import type { DomainPackage, RateRule } from '../../domain/rates.js';

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
  /** Media folders (T-192): photos, uploaded videos and video links, in the owner's order. */
  gallery: GalleryFolder[];
  /** '' = automatic cover (contracts `galleryCoverUrl`); else an image item's url. */
  galleryCover: string;
  /** Staff-only; never mapped to the bot product. */
  internalNote: string;
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
  /** T-193 details; ignored for the whole unit. */
  category: UnitCategory;
  view: string;
  areaM2: number | null;
  description: string;
  amenities: string[];
  /** Hard maximum party of the unit; null = none. */
  maxGuests: number | null;
  /** The unit's own media folders (same shape and cover rule as the property's). */
  gallery: GalleryFolder[];
  galleryCover: string;
}

/** A bedroom package of one target of a property (`unitId` null = the whole property). */
export interface PackageRecord extends DomainPackage {
  propertyId: string;
}

/** Every `BookingDto` field except the joined `propertyCode` / `propertyName` / `unitNames`. */
/** Stays that count as revenue, summed (`stayTotals`). Money is integer VND. */
export interface StayTotals {
  bookings: number;
  nights: number;
  revenue: number;
  cost: number;
}

export interface BookingRecord {
  id: string;
  code: string;
  propertyId: string;
  kind: 'stay' | 'block';
  whole: boolean;
  unitIds: string[];
  /** Package of each booked unit that has one (unit id → package id; T-193). */
  unitPackages: Record<string, string>;
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
  tags: string[];
  blockReason: string;
  /** First staff status action or edit of a bot booking (ISO); null = not reviewed. */
  reviewedAt: string | null;
  reviewedBy: string | null;
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

/** Staff-only note on one night of a property (`unitId` null) or of one room. */
export interface NightNoteRecord {
  id: string;
  propertyId: string;
  unitId: string | null;
  night: string;
  text: string;
}

/** The hold the bot summarised and the customer has not confirmed yet (one per conversation). */
export interface BotHoldDraftRecord {
  /** New on every prepare; the booking's `clientRequestId` is derived from it. */
  id: string;
  conversationId: string;
  botId: string;
  botName: string;
  channel: string;
  contactId: string | null;
  propertyId: string;
  whole: boolean;
  /** The rooms asked for (empty for a whole rental). */
  unitIds: string[];
  checkIn: string;
  checkOut: string;
  adults: number;
  childAges: number[];
  guestName: string;
  /** National form `0xxxxxxxxx`. */
  guestPhone: string;
  note: string;
  /** sha256 of the selection, party, guest and sell totals the customer saw. */
  quoteHash: string;
  /** The packages of the summary (T-193); confirm books exactly these. */
  packageIds: string[];
  createdAt: Date;
  expiresAt: Date;
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
  /** `lock` = SELECT … FOR NO KEY UPDATE (serializes property writers). */
  property(id: string, lock?: boolean): Promise<PropertyRecord | null>;
  insertProperty(p: PropertyRecord): Promise<void>;
  /** The caller bumps `version`. */
  updateProperty(p: PropertyRecord): Promise<void>;
  /** Whether any booking or block of the property exists, in any status (past ones included). */
  propertyHasBookings(propertyId: string): Promise<boolean>;
  /**
   * Hard-deletes the property; its units, packages, rates, night notes, bot links and bot hold
   * drafts cascade. A booking inserted concurrently (23503) → CONFLICT `property_has_bookings`.
   */
  deleteProperty(propertyId: string): Promise<void>;
  units(propertyIds: string[]): Promise<UnitRecord[]>;
  /** Upserts by id and deletes missing units; a deleted unit holding nights → CONFLICT. */
  replaceUnits(propertyId: string, units: UnitRecord[]): Promise<void>;
  rates(propertyIds: string[]): Promise<RateRule[]>;
  /** The rules of several properties in one query, keyed by property id (every id present). */
  ratesByProperty(propertyIds: string[]): Promise<Map<string, RateRule[]>>;
  /** Packages of the properties, by sort order. */
  packages(propertyIds: string[]): Promise<PackageRecord[]>;
  /**
   * Upserts the property's packages by id and deletes the missing ones (their rates cascade,
   * booking units keep their rows with the package cleared).
   */
  replacePackages(propertyId: string, packages: PackageRecord[]): Promise<void>;
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
  /**
   * Totals of the stays that count as revenue (confirmed, checked in or out; blocks excluded)
   * whose check-in night is in [from, to] inclusive.
   */
  stayTotals(from: string, to: string): Promise<StayTotals>;
  /**
   * The newest stay booking (held, confirmed, checked in or out) of each of these conversations,
   * by creation time; conversations without one are absent.
   */
  latestBookingByConversation(
    conversationIds: readonly string[],
  ): Promise<{ conversationId: string; at: Date }[]>;
  /** See `LodgingFacade.conversationBookings` (ids already filtered). */
  conversationBookings(q: {
    since: Date;
    until: Date;
    bookingIds?: readonly string[] | undefined;
  }): Promise<
    { bookingId: string; conversationId: string; createdAt: Date; total: number; status: string }[]
  >;
  /** Inserts the booking and its `unitIds` rows (with their `unitPackages`). */
  insertBooking(b: BookingRecord): Promise<void>;
  /** Updates the booking and replaces its `unitIds` rows (with their `unitPackages`). */
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
  /** Adds the property to every bot that has an explicit selection (bots without one sell all). */
  addPropertyToBots(propertyId: string): Promise<void>;
  /** Night notes of the properties for nights [from, to), ordered by night. */
  nightNotes(propertyIds: string[], from: string, to: string): Promise<NightNoteRecord[]>;
  /** Inserts or updates the note of (property, unit, night); returns the stored row. */
  upsertNightNote(note: NightNoteRecord, updatedBy: string): Promise<NightNoteRecord>;
  /** Deletes the note of (property, unit, night) if any. */
  deleteNightNote(propertyId: string, unitId: string | null, night: string): Promise<void>;
  /** Bot holds waiting for staff: source `bot`, status `hold`, `reviewedAt` null. */
  countBotHoldsToReview(): Promise<number>;
  /** `lock` = SELECT … FOR UPDATE (serializes confirmations of one draft). */
  botHoldDraft(conversationId: string, lock?: boolean): Promise<BotHoldDraftRecord | null>;
  /** Inserts or replaces the conversation's draft. */
  saveBotHoldDraft(draft: BotHoldDraftRecord): Promise<void>;
  /** Deletes the conversation's draft (only version `draftId` when given); true when one was. */
  deleteBotHoldDraft(conversationId: string, draftId?: string): Promise<boolean>;
  /** Deletes drafts expired at `now`. */
  sweepBotHoldDrafts(now: Date): Promise<void>;
  /** Audit trail of one booking, oldest first. */
  history(bookingId: string): Promise<BookingHistoryRecord[]>;
  audit(
    actorId: string | null,
    targetType: 'lodging_property' | 'lodging_booking' | 'lodging_settings' | 'bot',
    id: string,
    action: string,
    data: Record<string, unknown>,
    actorName?: string | null,
  ): Promise<void>;
  /** Integration event to the outbox in the same transaction; `payload.bookingId` is the aggregate. */
  publish(event: { name: string; payload: Record<string, unknown> }): Promise<void>;
}

export interface LodgingStore {
  run<T>(ws: WorkspaceId, fn: (tx: LodgingTx) => Promise<T>): Promise<T>;
}

export const LODGING_STORE = Symbol('LODGING_STORE');
