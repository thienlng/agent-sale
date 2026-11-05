import { z } from 'zod';

import { PublicImageUrl } from '../common/media.js';
import { GALLERY_MAX_FOLDERS, GalleryFolder } from '../lodging/gallery.js';

const Amount = z.number().int().min(0).max(1_000_000_000_000);
const text = (max: number) => z.string().trim().max(max);
/** `url` must be a URL returned by POST /products/images (the API rejects other links). */
const Image = z.object({
  url: PublicImageUrl,
  caption: text(300).min(1),
});

/** Local calendar date, never an instant or a browser-time-zone conversion. */
export const StayDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'must be a real calendar date');

/**
 * A bedroom package of a rental target (T-193): a price variant of the whole property or of one
 * unit. `weekdaySell[0]` is Monday … `[6]` Sunday, sell prices only; null = not sold that weekday.
 */
const AccommodationPackage = z.object({
  name: z.string(),
  bedrooms: z.number().int().min(1).max(100),
  standardAdults: z.number().int().min(0).max(1000),
  standardChildren: z.number().int().min(0).max(1000),
  maxGuests: z.number().int().min(1).max(2000).nullable(),
  weekdaySell: z.array(Amount.nullable()).length(7),
});

export const AccommodationDetails = z
  .object({
    /** `rooms` (T-160): a property rented per room; `roomLayout` may list fewer rows than bedrooms. */
    rentalType: z.enum(['entire_property', 'rooms']),
    /** Lodging v2 property code, e.g. `A17` (T-160). */
    code: z.string().optional(),
    bedrooms: z.number().int().min(1).max(100),
    standardAdults: z.number().int().min(1).max(1000),
    standardChildren: z.number().int().min(0).max(1000),
    childAgeBelow: z.number().int().min(1).max(18),
    maxGuests: z.number().int().min(1).max(2000).nullable(),
    roomLayout: z
      .array(z.object({ name: text(100).min(1), beds: text(500).min(1) }))
      .min(1)
      .max(100),
    amenities: z.array(text(200).min(1)).max(50),
    rateBasis: z.enum(['unconfirmed', 'night']),
    /** ISO weekday: Monday=1, Sunday=7. Amounts are reference VND until basis is confirmed. */
    rates: z
      .array(
        z.object({ days: z.array(z.number().int().min(1).max(7)).min(1).max(7), amount: Amount }),
      )
      .min(1)
      .max(7)
      .refine((rows) => {
        const days = rows.flatMap((r) => r.days);
        return days.length === 7 && new Set(days).size === 7;
      }, 'each weekday must occur exactly once'),
    checkInOut: text(500).default(''),
    depositPolicy: text(1000).default(''),
    cancellationPolicy: text(1000).default(''),
    extraGuestPolicy: text(1000).default(''),
    holidayPolicy: text(1000).default(''),
    gallery: z.array(Image).max(30),
    /**
     * Lodging media folders (T-192): filled only by the lodging bot product; older commerce rows
     * have none and a commerce product save refuses them (ALBUMS_LODGING_ONLY). `gallery` keeps
     * the flat photo list for them.
     */
    albums: z.array(GalleryFolder).max(GALLERY_MAX_FOLDERS).optional(),
    notes: text(3000).default(''),
    /** Lodging v2 (T-160): bookable rooms of a `rooms` property with their weekday rates. */
    units: z
      .array(
        z.object({
          name: z.string(),
          beds: z.string(),
          capacityAdults: z.number().int().min(0),
          capacityChildren: z.number().int().min(0),
          weekdayRates: z.array(
            z.object({ days: z.array(z.number().int().min(1).max(7)), amount: Amount }),
          ),
          /** Unit details (T-193); absent on rows written before them. */
          category: z.enum(['room', 'bungalow', 'house', 'other']).optional(),
          view: z.string().optional(),
          areaM2: z.number().int().min(1).max(100_000).nullable().optional(),
          description: z.string().optional(),
          amenities: z.array(z.string()).optional(),
          maxGuests: z.number().int().min(1).max(2000).nullable().optional(),
          /** The unit's own media folders; ids usable as `send_message` album / video ids. */
          albums: z.array(GalleryFolder).max(GALLERY_MAX_FOLDERS).optional(),
          /** The unit's bedroom packages; `weekdayRates` are its full package's prices. */
          packages: z.array(AccommodationPackage).max(10).optional(),
        }),
      )
      .optional(),
    /**
     * Bedroom packages of the whole property (T-193); `rates` are then the full package's prices.
     */
    packages: z.array(AccommodationPackage).max(10).optional(),
    /** Lodging v2 (T-160): date-range prices; inclusive nights; `unitName` null = whole property. */
    overrides: z
      .array(
        z.object({
          dateFrom: StayDate,
          dateTo: StayDate,
          label: z.string(),
          amount: Amount,
          unitName: z.string().nullable(),
        }),
      )
      .optional(),
    /** Lodging v2 (T-160): per person per night above the standard. */
    surcharges: z
      .object({
        extraAdult: Amount.nullable(),
        extraChild: Amount.nullable(),
        childFreeBelow: z.number().int().min(0).max(18),
        childAdultFrom: z.number().int().min(1).max(18),
      })
      .optional(),
  })
  .refine(
    (v) => v.rentalType !== 'entire_property' || v.roomLayout.length === v.bedrooms,
    'room layout must describe every bedroom',
  );
export type AccommodationDetails = z.infer<typeof AccommodationDetails>;

export const StayParty = z
  .object({
    adults: z.number().int().min(1).max(1000),
    children: z.number().int().min(0).max(1000),
    childAges: z.array(z.number().int().min(0).max(17)).max(1000).default([]),
  })
  .refine(
    (v) => v.childAges.length === 0 || v.childAges.length === v.children,
    'give every child age or leave ages unknown',
  );

export const StayDates = z.object({ checkIn: StayDate, checkOut: StayDate }).refine((v) => {
  const nights =
    (Date.parse(`${v.checkOut}T00:00:00Z`) - Date.parse(`${v.checkIn}T00:00:00Z`)) / 86400000;
  return nights >= 1 && nights <= 90;
}, 'checkout must be after checkin, at most 90 nights');

export const StayQuoteRequest = z.object({
  propertyId: z.uuid(),
  dates: StayDates,
  party: StayParty,
});
export type StayQuoteRequest = z.infer<typeof StayQuoteRequest>;

export const StayQuote = z.object({
  nights: z.number().int(),
  rateBasis: z.enum(['unconfirmed', 'night']),
  nightlyReferences: z.array(
    z.object({ date: StayDate, weekday: z.number().int(), amount: Amount }),
  ),
  baseTotal: Amount.nullable(),
  needsGuestApproval: z.boolean(),
  /** The internal calendar can prove a conflict, never physical availability. */
  internalAvailability: z.enum(['unverified', 'conflict']),
  isEstimate: z.literal(true),
});
export type StayQuote = z.infer<typeof StayQuote>;

export const CreateStayRequest = StayQuoteRequest.extend({
  clientRequestId: z.uuid(),
  guestName: text(120).min(1),
  guestPhone: text(40).min(5),
  note: text(2000).default(''),
});
export type CreateStayRequest = z.infer<typeof CreateStayRequest>;
export const StayStatus = z.enum(['requested', 'reviewing', 'confirmed', 'cancelled']);
export type StayStatus = z.infer<typeof StayStatus>;

export const StayRequestDto = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  propertyName: z.string(),
  clientRequestId: z.uuid(),
  guestName: z.string(),
  guestPhone: z.string(),
  dates: StayDates,
  party: StayParty,
  note: z.string(),
  status: StayStatus,
  quote: StayQuote,
  agreedTotal: Amount.nullable(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type StayRequestDto = z.infer<typeof StayRequestDto>;
export const StayRequestList = z.object({
  data: z.array(StayRequestDto),
  nextOffset: z.number().int().nonnegative().nullable(),
});
export const StayListQuery = z.object({
  propertyId: z.uuid().optional(),
  status: StayStatus.optional(),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
});
export const UpdateStayStatusRequest = z
  .object({
    status: StayStatus.exclude(['requested']),
    version: z.number().int().min(1),
    availabilityVerified: z.boolean().optional(),
    termsAndGuestsVerified: z.boolean().optional(),
    agreedTotal: Amount.optional(),
  })
  .refine(
    (v) =>
      v.status !== 'confirmed' ||
      (v.availabilityVerified === true &&
        v.termsAndGuestsVerified === true &&
        v.agreedTotal !== undefined),
    'confirmation requires verified availability, guests, terms and agreed total',
  );
export type UpdateStayStatusRequest = z.infer<typeof UpdateStayStatusRequest>;
