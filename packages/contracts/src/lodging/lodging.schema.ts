import { z } from 'zod';

import { Gallery, hasGalleryImage } from './gallery.js';

/**
 * Lodging v2 (T-160, spec 2026-11-01-lodging-calendar): properties → units → rates →
 * nightly calendar → bookings. Money is integer VND; nights are local calendar dates.
 */

/** A local calendar night 'YYYY-MM-DD' (the night that starts on that date). */
export const IsoNight = z.iso.date();
export const Vnd = z.number().int().min(0).max(1_000_000_000_000);
export const SignedVnd = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
export const SellMode = z.enum(['whole', 'rooms']);
export type SellMode = z.infer<typeof SellMode>;
export const PropertyStatus = z.enum(['active', 'paused']);
export type PropertyStatus = z.infer<typeof PropertyStatus>;
export const UnitKind = z.enum(['whole', 'room']);
export type UnitKind = z.infer<typeof UnitKind>;
export const BookingKind = z.enum(['stay', 'block']);
export type BookingKind = z.infer<typeof BookingKind>;
export const BookingStatus = z.enum([
  'hold',
  'confirmed',
  'checked_in',
  'checked_out',
  'cancelled',
  'expired',
  'no_show',
  'active',
  'removed',
]);
export type BookingStatus = z.infer<typeof BookingStatus>;
export const BookingSource = z.enum([
  'messenger',
  'zalo',
  'phone',
  'walk_in',
  'owner',
  'ota',
  'bot',
  'other',
]);
export type BookingSource = z.infer<typeof BookingSource>;
export const PriceRef = z.object({ sell: Vnd, cost: Vnd });
export type PriceRef = z.infer<typeof PriceRef>;

// ── Properties ────────────────────────────────────────────────────────────────

export const LayoutRoom = z.object({
  name: z.string().trim().min(1).max(100),
  beds: z.string().trim().max(500).default(''),
  note: z.string().trim().max(500).default(''),
});
/** Free text; an empty string means "unknown", never "none". */
export const Policies = z.object({
  checkInTime: z.string().max(50).default(''),
  checkOutTime: z.string().max(50).default(''),
  deposit: z.string().max(1000).default(''),
  cancellation: z.string().max(1000).default(''),
  houseRules: z.string().max(2000).default(''),
  other: z.string().max(2000).default(''),
});
export type Policies = z.infer<typeof Policies>;

/** Property field validators without defaults; shared by create (with defaults) and patch. */
const propertyShape = {
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/),
  name: z.string().trim().min(1).max(200),
  area: z.string().trim().max(200),
  address: z.string().trim().max(500),
  description: z.string().trim().max(5000),
  sellMode: SellMode,
  status: PropertyStatus,
  standardAdults: z.number().int().min(1).max(1000),
  standardChildren: z.number().int().min(0).max(1000),
  maxGuests: z.number().int().min(1).max(2000).nullable(),
  /** Children younger than this are free within `standardChildren`. */
  childFreeBelow: z.number().int().min(0).max(18),
  /** From this age a child counts as an adult. */
  childAdultFrom: z.number().int().min(1).max(18),
  amenities: z.array(z.string().trim().min(1).max(200)).max(80),
  layout: z.array(LayoutRoom).max(100),
  policies: Policies,
  /** Media folders (T-192): photos, uploaded videos and video links, in the owner's order. */
  gallery: Gallery,
  /** '' = automatic (first image of the first folder that has one); else an image item's url. */
  galleryCover: z.string().trim().max(2000),
  /** Staff-only note about the property (owner habits, keys…); never reaches the bot. */
  internalNote: z.string().trim().max(2000),
};

/**
 * Property fields with create defaults, without the cross-field refinement. Zod 4 forbids
 * `.partial()` / `.extend()` on refined objects, so derived schemas start from this one.
 */
export const PropertyFields = z.object({
  ...propertyShape,
  area: propertyShape.area.default(''),
  address: propertyShape.address.default(''),
  description: propertyShape.description.default(''),
  status: propertyShape.status.default('active'),
  maxGuests: propertyShape.maxGuests.default(null),
  childFreeBelow: propertyShape.childFreeBelow.default(6),
  childAdultFrom: propertyShape.childAdultFrom.default(12),
  amenities: propertyShape.amenities.default([]),
  layout: propertyShape.layout.default([]),
  policies: propertyShape.policies.prefault({}),
  gallery: propertyShape.gallery.default([]),
  galleryCover: propertyShape.galleryCover.default(''),
  internalNote: propertyShape.internalNote.default(''),
});
/**
 * PATCH fields: every field optional and WITHOUT defaults, so omitted fields stay absent
 * and never overwrite stored values. A given `policies` / `layout` / `gallery` replaces the
 * stored value as a whole; `galleryCover` is checked against the merged gallery (inner item
 * defaults still apply to what is sent). A `gallery` sent without `galleryCover` resets a stored
 * cover that is no longer one of its images to '' (the lodging service does it before this check).
 */
export const PropertyPatchFields = z.object(propertyShape).partial();
export type PropertyPatchFields = z.infer<typeof PropertyPatchFields>;
export const PropertyInput = PropertyFields.refine(
  (v) => v.childFreeBelow <= v.childAdultFrom,
  'childFreeBelow must not exceed childAdultFrom',
).refine((v) => v.galleryCover === '' || hasGalleryImage(v.gallery, v.galleryCover), {
  message: 'galleryCover must be the url of an image in the gallery',
  path: ['galleryCover'],
});
export type PropertyInput = z.input<typeof PropertyInput>;
export const UpdatePropertyRequest = z.object({
  version: z.number().int().positive(),
  patch: PropertyPatchFields,
});
export type UpdatePropertyRequest = z.infer<typeof UpdatePropertyRequest>;

// ── Units ─────────────────────────────────────────────────────────────────────

export const UnitDto = z.object({
  id: z.uuid(),
  kind: UnitKind,
  name: z.string(),
  beds: z.string(),
  capacityAdults: z.number().int(),
  capacityChildren: z.number().int(),
  active: z.boolean(),
  sortOrder: z.number().int(),
});
export type UnitDto = z.infer<typeof UnitDto>;
export const UnitInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
  beds: z.string().trim().max(500).default(''),
  capacityAdults: z.number().int().min(1).max(100),
  capacityChildren: z.number().int().min(0).max(100).default(0),
  active: z.boolean().default(true),
});
export const ReplaceUnitsRequest = z.object({
  version: z.number().int().positive(),
  units: z.array(UnitInput).min(1).max(100),
});
export type ReplaceUnitsRequest = z.infer<typeof ReplaceUnitsRequest>;

// ── Rates ─────────────────────────────────────────────────────────────────────

/** `unitId` null = the whole property; ISO weekdays Monday=1 … Sunday=7. */
export const WeekdayRate = z.object({
  unitId: z.uuid().nullable(),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  sell: Vnd,
  cost: Vnd,
});
/** Per person per night above the standard. */
export const Surcharges = z.object({
  extraAdult: PriceRef.nullable(),
  extraChild: PriceRef.nullable(),
});
export type Surcharges = z.infer<typeof Surcharges>;
export const PutRatesRequest = z.object({
  version: z.number().int().positive(),
  weekday: z.array(WeekdayRate).min(1).max(800),
  surcharges: Surcharges,
});
export type PutRatesRequest = z.infer<typeof PutRatesRequest>;
/** Override field validators without defaults; shared by create (with defaults) and patch. */
const overrideShape = {
  unitId: z.uuid().nullable(),
  dateFrom: IsoNight,
  dateTo: IsoNight,
  label: z.string().trim().min(1).max(100),
  sell: Vnd,
  cost: Vnd,
  minNights: z.number().int().min(1).max(60).nullable(),
};
/** Date-range price; `dateFrom`..`dateTo` are inclusive nights. */
export const OverrideInput = z.object({
  ...overrideShape,
  minNights: overrideShape.minNights.default(null),
});
export type OverrideInput = z.infer<typeof OverrideInput>;
/** POST body: the override plus the property version it was edited against. */
export const CreateOverrideRequest = OverrideInput.extend({ version: z.number().int().positive() });
export type CreateOverrideRequest = z.infer<typeof CreateOverrideRequest>;
/** PATCH body: `version` is the property version; omitted fields stay absent (no defaults). */
export const UpdateOverrideRequest = z.object(overrideShape).partial().extend({
  version: z.number().int().positive(),
});
export type UpdateOverrideRequest = z.infer<typeof UpdateOverrideRequest>;
/** DELETE query: the property version. */
export const DeleteOverrideQuery = z.object({ version: z.coerce.number().int().positive() });
export const RateDto = z.object({
  id: z.uuid(),
  unitId: z.uuid().nullable(),
  kind: z.enum(['weekday', 'override']),
  weekdays: z.array(z.number().int()),
  dateFrom: IsoNight.nullable(),
  dateTo: IsoNight.nullable(),
  label: z.string(),
  sell: Vnd,
  cost: Vnd,
  minNights: z.number().int().nullable(),
});
export type RateDto = z.infer<typeof RateDto>;

export const PropertyDto = PropertyFields.extend({
  id: z.uuid(),
  units: z.array(UnitDto),
  rates: z.array(RateDto),
  surcharges: Surcharges,
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PropertyDto = z.infer<typeof PropertyDto>;
export const PropertySummary = PropertyDto.omit({ rates: true }).extend({
  today: z.enum(['free', 'hold', 'occupied', 'blocked', 'partial']),
  /**
   * Whole-property sell price per ISO weekday (index 0 = Monday … 6 = Sunday) from the weekday
   * rates, without date overrides. A room-sold property without a whole rate sums its active
   * rooms. Null = that weekday is not fully priced.
   */
  weekdaySell: z.array(Vnd.nullable()).length(7),
});
export type PropertySummary = z.infer<typeof PropertySummary>;
export const PropertyList = z.object({ data: z.array(PropertySummary) });
export type PropertyList = z.infer<typeof PropertyList>;

// ── Quote ─────────────────────────────────────────────────────────────────────

export const Party = z.object({
  adults: z.number().int().min(0).max(1000),
  childAges: z.array(z.number().int().min(0).max(17)).max(1000).default([]),
});
export type Party = z.infer<typeof Party>;
/** `whole` = rent the whole property (every active room of a rooms property). */
export const StaySelection = z.object({
  propertyId: z.uuid(),
  whole: z.boolean(),
  unitIds: z.array(z.uuid()).max(100).default([]),
  checkIn: IsoNight,
  checkOut: IsoNight,
});
export const QuoteRequest = StaySelection.extend({ party: Party });
export type QuoteRequest = z.infer<typeof QuoteRequest>;
export const QuoteNight = z.object({
  date: IsoNight,
  weekday: z.number().int(),
  label: z.string(),
  sell: Vnd,
  cost: Vnd,
});
export const QuoteSurcharge = z.object({
  kind: z.enum(['extra_adult', 'extra_child']),
  persons: z.number().int(),
  nights: z.number().int(),
  sell: Vnd,
  cost: Vnd,
});
export const QuoteWarning = z.enum([
  'min_nights',
  'missing_rate',
  'over_max',
  'over_standard',
  'child_ages_missing',
]);
export type QuoteWarning = z.infer<typeof QuoteWarning>;
export const QuoteDto = z.object({
  nights: z.array(QuoteNight),
  surcharges: z.array(QuoteSurcharge),
  totalSell: Vnd.nullable(),
  totalCost: Vnd.nullable(),
  warnings: z.array(QuoteWarning),
  /** Booking codes occupying requested nights. */
  takenBy: z.array(z.string()),
});
export type QuoteDto = z.infer<typeof QuoteDto>;

// ── Bookings ──────────────────────────────────────────────────────────────────

/**
 * One tag as stored: NFC-normalised and trimmed, so "Đã cọc" typed with combining marks (NFD)
 * equals the NFC suggestion and the list filter.
 */
export function normalizeBookingTag(tag: string): string {
  return tag.normalize('NFC').trim();
}
/** Tags as stored: normalised, without empties or duplicates, first occurrence first. */
export function normalizeBookingTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map(normalizeBookingTag).filter(Boolean))];
}
/** A free-text label on a booking (e.g. "Đã cọc"); labels only, never money logic. */
export const BookingTag = z.string().normalize('NFC').trim().min(1).max(30);
/** At most 8 tags; the server normalises (`normalizeBookingTags`), keeping the first occurrence. */
export const BookingTags = z.array(BookingTag).max(8);

export const CreateBookingRequest = z.discriminatedUnion('kind', [
  StaySelection.extend({
    kind: z.literal('stay'),
    clientRequestId: z.uuid(),
    status: z.enum(['hold', 'confirmed']),
    party: Party,
    guestName: z.string().trim().min(1).max(200),
    guestPhone: z.string().trim().max(30).default(''),
    source: BookingSource,
    contactId: z.uuid().nullable().default(null),
    conversationId: z.uuid().nullable().default(null),
    adjustment: SignedVnd.default(0),
    adjustmentReason: z.string().max(300).default(''),
    manualTotalSell: Vnd.nullable().default(null),
    note: z.string().max(2000).default(''),
    tags: BookingTags.default([]),
  }),
  StaySelection.extend({
    kind: z.literal('block'),
    clientRequestId: z.uuid(),
    blockReason: z.string().trim().min(1).max(300),
  }),
]);
export type CreateBookingRequest = z.infer<typeof CreateBookingRequest>;
export const UpdateBookingRequest = z.object({
  version: z.number().int().positive(),
  checkIn: IsoNight.optional(),
  checkOut: IsoNight.optional(),
  whole: z.boolean().optional(),
  unitIds: z.array(z.uuid()).max(100).optional(),
  party: Party.optional(),
  guestName: z.string().trim().min(1).max(200).optional(),
  guestPhone: z.string().trim().max(30).optional(),
  adjustment: SignedVnd.optional(),
  adjustmentReason: z.string().max(300).optional(),
  manualTotalSell: Vnd.nullable().optional(),
  note: z.string().max(2000).optional(),
  tags: BookingTags.optional(),
});
export type UpdateBookingRequest = z.infer<typeof UpdateBookingRequest>;
export const BookingAction = z.enum([
  'confirm',
  'check_in',
  'check_out',
  'cancel',
  'no_show',
  'extend_hold',
  'remove_block',
]);
export type BookingAction = z.infer<typeof BookingAction>;
export const BookingStatusRequest = z.object({
  version: z.number().int().positive(),
  action: BookingAction,
  reason: z.string().max(300).default(''),
  holdMinutes: z.number().int().min(15).max(1440).optional(),
});
export type BookingStatusRequest = z.infer<typeof BookingStatusRequest>;

export const BookingDto = z.object({
  id: z.uuid(),
  code: z.string(),
  propertyId: z.uuid(),
  propertyCode: z.string(),
  propertyName: z.string(),
  kind: BookingKind,
  whole: z.boolean(),
  unitIds: z.array(z.uuid()),
  unitNames: z.array(z.string()),
  status: BookingStatus,
  checkIn: IsoNight,
  checkOut: IsoNight,
  party: Party,
  guestName: z.string(),
  guestPhone: z.string(),
  contactId: z.uuid().nullable(),
  conversationId: z.uuid().nullable(),
  source: BookingSource.nullable(),
  holdExpiresAt: z.iso.datetime().nullable(),
  quote: QuoteDto.nullable(),
  adjustment: SignedVnd,
  adjustmentReason: z.string(),
  totalSell: Vnd.nullable(),
  totalCost: Vnd.nullable(),
  note: z.string(),
  tags: z.array(z.string()),
  blockReason: z.string(),
  /** First staff action on a bot booking; a bot hold with null here waits for staff (T-161). */
  reviewedAt: z.iso.datetime().nullable(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type BookingDto = z.infer<typeof BookingDto>;
export const BookingHistoryEntry = z.object({
  at: z.iso.datetime(),
  actorName: z.string().nullable(),
  action: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export const BookingDetail = BookingDto.extend({ history: z.array(BookingHistoryEntry) });
export type BookingDetail = z.infer<typeof BookingDetail>;
export const BookingListQuery = z.object({
  view: z.enum(['today', 'holds', 'upcoming', 'all']).default('upcoming'),
  propertyId: z.uuid().optional(),
  status: BookingStatus.optional(),
  q: z.string().max(100).optional(),
  conversationId: z.uuid().optional(),
  /** Bookings carrying exactly this tag. */
  tag: BookingTag.optional(),
  /** Bookings from this source only (e.g. `bot`). */
  source: BookingSource.optional(),
  offset: z.coerce.number().int().min(0).default(0),
});
export type BookingListQuery = z.infer<typeof BookingListQuery>;
export const BookingList = z.object({
  data: z.array(BookingDto),
  nextOffset: z.number().int().nullable(),
});
export type BookingList = z.infer<typeof BookingList>;
/** Bot holds waiting for staff: `source = bot`, status `hold`, not reviewed yet. */
export const BookingReviewCount = z.object({ pending: z.number().int().min(0) });
export type BookingReviewCount = z.infer<typeof BookingReviewCount>;

// ── Calendar & availability ──────────────────────────────────────────────────

export const CalendarQuery = z.object({
  from: IsoNight,
  to: IsoNight,
  /** Comma-separated property uuids. */
  propertyIds: z.string().optional(),
});
export type CalendarQuery = z.infer<typeof CalendarQuery>;
const NightPrice = z.object({ night: IsoNight, sell: Vnd.nullable(), label: z.string() });
export const CalendarSegment = z.object({
  bookingId: z.uuid(),
  code: z.string(),
  kind: BookingKind,
  status: BookingStatus,
  from: IsoNight,
  /** Exclusive. */
  to: IsoNight,
  guestName: z.string(),
  blockReason: z.string(),
  holdExpiresAt: z.iso.datetime().nullable(),
  /** Quick-view details of a stay (empty / null on blocks). */
  guestPhone: z.string(),
  party: z.object({ adults: z.number().int(), childAges: z.array(z.number().int()) }),
  totalSell: Vnd.nullable(),
  tags: z.array(z.string()),
  note: z.string(),
});
export const CalendarRow = z.object({
  unitId: z.uuid(),
  name: z.string(),
  kind: UnitKind,
  prices: z.array(NightPrice),
  segments: z.array(CalendarSegment),
});
/** Internal note on one night of a property (`unitId` null) or of one room. Staff only. */
export const NightNoteDto = z.object({
  id: z.uuid(),
  unitId: z.uuid().nullable(),
  night: IsoNight,
  text: z.string(),
});
export type NightNoteDto = z.infer<typeof NightNoteDto>;
/** PUT body: upsert the note of one night; an empty (or blank) text deletes it. */
export const PutNightNoteRequest = z.object({
  unitId: z.uuid().nullable().default(null),
  night: IsoNight,
  text: z.string().trim().max(300),
});
export type PutNightNoteRequest = z.infer<typeof PutNightNoteRequest>;
/** The saved note, or null when the text was empty and the note is gone. */
export const NightNoteResult = z.object({ note: NightNoteDto.nullable() });
export type NightNoteResult = z.infer<typeof NightNoteResult>;
export const CalendarProperty = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  area: z.string(),
  sellMode: SellMode,
  standardAdults: z.number().int(),
  standardChildren: z.number().int(),
  wholePrices: z.array(NightPrice),
  rows: z.array(CalendarRow),
  /** Staff-only property note (hover card on the property name). */
  internalNote: z.string(),
  /** Night notes inside [from, to). */
  notes: z.array(NightNoteDto),
});
export const CalendarDto = z.object({
  from: IsoNight,
  to: IsoNight,
  today: IsoNight,
  properties: z.array(CalendarProperty),
});
export type CalendarDto = z.infer<typeof CalendarDto>;

export const AvailabilityRequest = z.object({
  checkIn: IsoNight,
  checkOut: IsoNight,
  party: Party,
  propertyIds: z.array(z.uuid()).max(200).optional(),
});
export type AvailabilityRequest = z.infer<typeof AvailabilityRequest>;
export const AvailabilityOption = z.object({
  propertyId: z.uuid(),
  whole: z.boolean(),
  unitIds: z.array(z.uuid()),
  fits: z.boolean(),
  quote: QuoteDto,
});
export const AvailabilityDto = z.object({ options: z.array(AvailabilityOption) });
export type AvailabilityDto = z.infer<typeof AvailabilityDto>;

// ── Settings & bots ──────────────────────────────────────────────────────────

export const LodgingSettings = z.object({ holdMinutes: z.number().int().min(15).max(1440) });
export type LodgingSettings = z.infer<typeof LodgingSettings>;
export const BotPropertiesDto = z.object({ propertyIds: z.array(z.uuid()) });
export type BotPropertiesDto = z.infer<typeof BotPropertiesDto>;
