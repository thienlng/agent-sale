import type { Party, QuoteDto } from '@agent-sales/contracts';

/** Guests as typed: a child's age stays null until it is entered. */
export interface PartyValue {
  adults: number;
  childAges: Array<number | null>;
}

export const EMPTY_PARTY: PartyValue = { adults: 2, childAges: [] };

/** The API party, or null while a child's age is missing. */
export function toParty(value: PartyValue): Party | null {
  if (value.childAges.some((a) => a === null)) return null;
  return { adults: value.adults, childAges: value.childAges as number[] };
}

/** The editable money fields next to a quote. */
export interface PriceFields {
  adjustment: number;
  adjustmentReason: string;
  /** Agreed room total typed by staff; null = use the calculated quote. */
  manualTotal: number | null;
}

/** Total the server will store: (manual ?? quote) + adjustment; null without any base. */
export function bookingTotal(
  quote: QuoteDto | undefined | null,
  price: PriceFields,
): number | null {
  const base = price.manualTotal ?? quote?.totalSell ?? null;
  return base === null ? null : base + price.adjustment;
}
