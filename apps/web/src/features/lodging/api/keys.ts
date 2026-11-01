import type { BookingListQuery } from '@agent-sales/contracts';

/**
 * Query keys of the lodging feature. Every key starts with `lodging(ws)`, so a
 * mutation refreshes the calendar, the lists and the quotes by invalidating it.
 */
export const lodgingKeys = {
  all: (ws: string) => ['ws', ws, 'lodging'] as const,
  properties: (ws: string) => ['ws', ws, 'lodging', 'properties'] as const,
  property: (ws: string, id: string) => ['ws', ws, 'lodging', 'properties', id] as const,
  bookings: (ws: string, query: Partial<BookingListQuery>) =>
    ['ws', ws, 'lodging', 'bookings', 'list', query] as const,
  booking: (ws: string, id: string) => ['ws', ws, 'lodging', 'bookings', 'detail', id] as const,
  calendar: (ws: string, from: string, to: string, propertyIds: readonly string[]) =>
    ['ws', ws, 'lodging', 'calendar', from, to, propertyIds] as const,
  availability: (ws: string, body: unknown) => ['ws', ws, 'lodging', 'availability', body] as const,
  quote: (ws: string, body: unknown) => ['ws', ws, 'lodging', 'quote', body] as const,
  settings: (ws: string) => ['ws', ws, 'lodging', 'settings'] as const,
  botProperties: (ws: string, botId: string) =>
    ['ws', ws, 'lodging', 'bots', botId, 'properties'] as const,
};
