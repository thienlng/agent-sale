/**
 * Integration events published by lodging (outbox, aggregate `lodging_booking`). Payloads carry
 * ids, codes, dates and statuses only — never guest names or phone numbers.
 */
export const LODGING_EVENT_TYPES = [
  'lodging.booking.created.v1',
  'lodging.booking.confirmed.v1',
  'lodging.booking.cancelled.v1',
  'lodging.booking.expired.v1',
  'lodging.booking.checked_in.v1',
  'lodging.booking.checked_out.v1',
] as const;
export type LodgingEventType = (typeof LODGING_EVENT_TYPES)[number];

/** `lodging.booking.created.v1`. */
export interface LodgingBookingCreatedV1 {
  bookingId: string;
  code: string;
  propertyId: string;
  status: string;
  checkIn: string;
  checkOut: string;
  source: string | null;
}

/** Every status event (`confirmed`, `cancelled`, `expired`, `checked_in`, `checked_out`). */
export interface LodgingBookingStatusV1 {
  bookingId: string;
  code: string;
  propertyId: string;
}
