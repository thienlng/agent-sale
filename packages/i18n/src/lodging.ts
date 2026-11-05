import en from './messages/en/lodging.json' with { type: 'json' };
import vi from './messages/vi/lodging.json' with { type: 'json' };

/**
 * The `lodging` namespace (properties, rates, calendar, bookings; hotel businesses only) in every
 * locale. Kept out of `./vi` so it stays out of the initial bundle (docs/16 §1): the web app loads
 * it when a lodging page opens. Shell strings (nav labels and counts) stay in `common`.
 */
export const lodging = { vi, en } as const;
