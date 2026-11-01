import {
  AvailabilityDto,
  type AvailabilityRequest,
  CalendarDto,
  QuoteDto,
  type QuoteRequest,
} from '@agent-sales/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { z } from 'zod';

import { api } from '@/lib/api-client';
import { withQuery } from '@/lib/url';
import { useWorkspaceId } from '@/lib/use-workspace';

import { lodgingKeys } from './keys';

/**
 * Units with per-night prices and occupying bookings for nights `from` ≤ n < `to`
 * (at most 62). Without `propertyIds` the server returns every active property.
 */
export function useLodgingCalendar(range: {
  from: string;
  to: string;
  propertyIds?: readonly string[];
}) {
  const ws = useWorkspaceId();
  const ids = range.propertyIds ?? [];
  return useQuery({
    queryKey: lodgingKeys.calendar(ws, range.from, range.to, ids),
    queryFn: ({ signal }) =>
      api(
        withQuery('/lodging/calendar', {
          from: range.from,
          to: range.to,
          propertyIds: ids.join(','),
        }),
        CalendarDto,
        { workspaceId: ws, signal },
      ),
    enabled: Boolean(ws && range.from && range.to),
    placeholderData: keepPreviousData,
  });
}

/** Free whole properties or rooms with fit flags and quotes; idle while `body` is null. */
export function useAvailability(body: z.input<typeof AvailabilityRequest> | null) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: lodgingKeys.availability(ws, body),
    queryFn: ({ signal }) =>
      api('/lodging/availability', AvailabilityDto, {
        method: 'POST',
        body,
        workspaceId: ws,
        signal,
      }),
    enabled: Boolean(ws && body),
  });
}

/** Quote a concrete selection without writing anything; idle while `body` is null. */
export function useQuote(body: z.input<typeof QuoteRequest> | null) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: lodgingKeys.quote(ws, body),
    queryFn: ({ signal }) =>
      api('/lodging/quote', QuoteDto, { method: 'POST', body, workspaceId: ws, signal }),
    enabled: Boolean(ws && body),
    placeholderData: keepPreviousData,
  });
}
