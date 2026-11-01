import type { BookingSource, CreateBookingRequest, QuoteRequest } from '@agent-sales/contracts';
import { useMemo, useState } from 'react';
import type { z } from 'zod';

import { useQuote } from '../api/calendar';
import { isStayRange } from '../lib/format';
import { EMPTY_PARTY, type PartyValue, type PriceFields, toParty } from '../lib/party';
import { useDebouncedValue } from './use-debounced-value';

export type CreateKind = 'hold' | 'confirmed' | 'block';

/** Prefill of a new booking (calendar selection, find result, inbox contact). */
export interface BookingCreateInitial {
  kind?: CreateKind;
  propertyId?: string;
  checkIn?: string;
  checkOut?: string;
  whole?: boolean;
  unitIds?: string[];
  party?: { adults: number; childAges: number[] };
  guestName?: string;
  guestPhone?: string;
  contactId?: string | null;
  conversationId?: string | null;
  /** Where the guest came from; default `phone`. */
  source?: BookingSource;
}

export interface BookingDraft extends PriceFields {
  kind: CreateKind;
  propertyId: string;
  checkIn: string;
  checkOut: string;
  whole: boolean;
  unitIds: string[];
  party: PartyValue;
  guestName: string;
  guestPhone: string;
  source: BookingSource;
  note: string;
  blockReason: string;
}

export function draftFrom(initial: BookingCreateInitial = {}): BookingDraft {
  return {
    kind: initial.kind ?? 'hold',
    propertyId: initial.propertyId ?? '',
    checkIn: initial.checkIn ?? '',
    checkOut: initial.checkOut ?? '',
    whole: initial.whole ?? true,
    unitIds: initial.unitIds ?? [],
    party: initial.party ?? EMPTY_PARTY,
    guestName: initial.guestName ?? '',
    guestPhone: initial.guestPhone ?? '',
    source: initial.source ?? 'phone',
    note: '',
    blockReason: '',
    adjustment: 0,
    adjustmentReason: '',
    manualTotal: null,
  };
}

/** The quote request of a stay selection, or null while it is incomplete. */
export function quoteBody(d: {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  whole: boolean;
  unitIds: string[];
  party: PartyValue;
}): z.input<typeof QuoteRequest> | null {
  const party = toParty(d.party);
  if (!d.propertyId || !party || !isStayRange(d.checkIn, d.checkOut)) return null;
  if (!d.whole && d.unitIds.length === 0) return null;
  return {
    propertyId: d.propertyId,
    whole: d.whole,
    unitIds: d.whole ? [] : d.unitIds,
    checkIn: d.checkIn,
    checkOut: d.checkOut,
    party,
  };
}

export type DraftErrors = Partial<
  Record<'property' | 'range' | 'units' | 'guestName' | 'blockReason' | 'party', true>
>;

export function validateDraft(d: BookingDraft): DraftErrors {
  const e: DraftErrors = {};
  if (!d.propertyId) e.property = true;
  if (!isStayRange(d.checkIn, d.checkOut)) e.range = true;
  if (!d.whole && d.unitIds.length === 0) e.units = true;
  if (d.kind === 'block') {
    if (!d.blockReason.trim()) e.blockReason = true;
  } else {
    if (!d.guestName.trim()) e.guestName = true;
    if (!toParty(d.party)) e.party = true;
  }
  return e;
}

export function createRequest(
  d: BookingDraft,
  clientRequestId: string,
  links: { contactId?: string | null; conversationId?: string | null },
): z.input<typeof CreateBookingRequest> {
  const selection = {
    propertyId: d.propertyId,
    whole: d.whole,
    unitIds: d.whole ? [] : d.unitIds,
    checkIn: d.checkIn,
    checkOut: d.checkOut,
    clientRequestId,
  };
  if (d.kind === 'block') return { kind: 'block', ...selection, blockReason: d.blockReason.trim() };
  return {
    kind: 'stay',
    ...selection,
    status: d.kind,
    party: toParty(d.party) ?? { adults: d.party.adults, childAges: [] },
    guestName: d.guestName.trim(),
    guestPhone: d.guestPhone.trim(),
    source: d.source,
    contactId: links.contactId ?? null,
    conversationId: links.conversationId ?? null,
    adjustment: d.adjustment,
    adjustmentReason: d.adjustmentReason,
    manualTotalSell: d.manualTotal,
    note: d.note,
  };
}

/** Draft state of the create form with a live quote debounced by 300 ms. */
export function useBookingDraft(initial: BookingCreateInitial | undefined) {
  const [draft, setDraft] = useState(() => draftFrom(initial));
  // Blocks are quoted too: the quote's `takenBy` lists the bookings in the way.
  const body = useMemo(
    () =>
      quoteBody(draft.kind === 'block' ? { ...draft, party: { adults: 1, childAges: [] } } : draft),
    [draft],
  );
  const debounced = useDebouncedValue(body, 300);
  const quote = useQuote(debounced);
  const patch = (p: Partial<BookingDraft>) => setDraft((d) => ({ ...d, ...p }));
  return { draft, patch, quote, quoteStale: body !== debounced };
}
