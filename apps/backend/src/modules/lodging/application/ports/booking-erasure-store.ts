import type { WorkspaceId } from '@agent-sales/shared';

export interface BookingErasureTx {
  /**
   * Replaces the guest of the customer's stay bookings — linked by `contact_id`, by one of the
   * customer's conversations, or with the customer's phone (digits only) — with `guestName`, clears
   * the phone and the customer link; returns how many bookings changed.
   */
  anonymizeBookings(q: {
    contactId: string;
    conversationIds: readonly string[];
    phoneDigits: readonly string[];
    guestName: string;
  }): Promise<number>;
  /** The bot's pending hold summaries of the customer or of these conversations. */
  deleteHoldDrafts(contactId: string, conversationIds: readonly string[]): Promise<void>;
}

/** Customer deletion's part in lodging (docs/09 §10); one tenant transaction per call. */
export interface BookingErasureStore {
  run<T>(ws: WorkspaceId, fn: (tx: BookingErasureTx) => Promise<T>): Promise<T>;
}
export const BOOKING_ERASURE_STORE = Symbol('BOOKING_ERASURE_STORE');
