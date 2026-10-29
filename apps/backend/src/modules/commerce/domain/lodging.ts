import type {
  AccommodationDetails,
  StayQuote,
  StayQuoteRequest,
  StayStatus,
} from '@agent-sales/contracts';
import { DomainError } from '@agent-sales/shared';

export class LodgingError extends DomainError {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_FAILED' | 'FORBIDDEN',
    message: string,
  ) {
    super(message);
  }
}

/** Reference rates never become a binding total until the owner confirms their basis. */
export function quoteStay(
  details: AccommodationDetails,
  input: StayQuoteRequest,
  conflict: boolean,
): StayQuote {
  const start = Date.parse(`${input.dates.checkIn}T00:00:00Z`);
  const end = Date.parse(`${input.dates.checkOut}T00:00:00Z`);
  const nightlyReferences: StayQuote['nightlyReferences'] = [];
  for (let day = start; day < end; day += 86400000) {
    const d = new Date(day),
      weekday = d.getUTCDay() || 7;
    const rate = details.rates.find((r) => r.days.includes(weekday));
    if (!rate)
      throw new LodgingError(
        'VALIDATION_FAILED',
        'The property has no reference rate for a requested weekday',
      );
    nightlyReferences.push({ date: d.toISOString().slice(0, 10), weekday, amount: rate.amount });
  }
  const p = input.party;
  if (
    details.rateBasis === 'night' &&
    nightlyReferences.reduce((n, r) => n + r.amount, 0) > 1_000_000_000_000
  )
    throw new LodgingError('VALIDATION_FAILED', 'The stay total exceeds the supported amount');
  const unknownOrOlderChildren =
    p.children > 0 &&
    (p.childAges.length !== p.children || p.childAges.some((age) => age >= details.childAgeBelow));
  return {
    nights: nightlyReferences.length,
    rateBasis: details.rateBasis,
    nightlyReferences,
    baseTotal:
      details.rateBasis === 'night' ? nightlyReferences.reduce((n, r) => n + r.amount, 0) : null,
    needsGuestApproval:
      p.adults > details.standardAdults ||
      p.children > details.standardChildren ||
      unknownOrOlderChildren ||
      (details.maxGuests !== null && p.adults + p.children > details.maxGuests),
    internalAvailability: conflict ? 'conflict' : 'unverified',
    isEstimate: true,
  };
}

export function assertStayTransition(from: StayStatus, to: StayStatus): void {
  const allowed: Record<StayStatus, readonly StayStatus[]> = {
    requested: ['reviewing', 'confirmed', 'cancelled'],
    reviewing: ['confirmed', 'cancelled'],
    confirmed: ['cancelled'],
    cancelled: [],
  };
  if (!allowed[from].includes(to))
    throw new LodgingError('CONFLICT', 'This lodging request cannot move to that status');
}
