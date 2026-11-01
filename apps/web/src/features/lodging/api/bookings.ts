import {
  BookingDetail,
  BookingList,
  type BookingListQuery,
  BookingReviewCount,
  type BookingStatusRequest,
  type CreateBookingRequest,
  type UpdateBookingRequest,
} from '@agent-sales/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import { api, ApiClientError } from '@/lib/api-client';
import { withQuery } from '@/lib/url';
import { useWorkspaceId } from '@/lib/use-workspace';

import { lodgingKeys } from './keys';

/** Booking lists: `today`, `holds`, `upcoming` (default) or `all`; 100 per page. */
export function useBookings(query: Partial<BookingListQuery> = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: lodgingKeys.bookings(ws, query),
    queryFn: ({ signal }) =>
      api(withQuery('/lodging/bookings', query), BookingList, { workspaceId: ws, signal }),
    enabled: Boolean(ws),
    placeholderData: keepPreviousData,
  });
}

/**
 * How many bot holds wait for staff (`source = bot`, on hold, not handled yet). Refreshed by
 * every booking change (it lives under `lodging(ws)`) and polled each minute, since the bot
 * places holds while the page stays open.
 */
export function useBookingReviewCount({ enabled = true }: { enabled?: boolean } = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: lodgingKeys.reviewCount(ws),
    queryFn: ({ signal }) =>
      api('/lodging/bookings/review-count', BookingReviewCount, { workspaceId: ws, signal }),
    enabled: Boolean(ws) && enabled,
    refetchInterval: 60_000,
  });
}

/** One booking with its history. */
export function useBooking(id: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: lodgingKeys.booking(ws, id ?? ''),
    queryFn: ({ signal }) =>
      api(`/lodging/bookings/${id}`, BookingDetail, { workspaceId: ws, signal }),
    enabled: Boolean(ws && id),
  });
}

function useBookingMutation<V>(mutationFn: (ws: string, vars: V) => Promise<BookingDetail>) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) => mutationFn(ws, vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: lodgingKeys.all(ws) }),
  });
}

/** Create a hold, a confirmed booking or a block; idempotent by `clientRequestId`. */
export function useCreateBooking() {
  return useBookingMutation((ws, body: z.input<typeof CreateBookingRequest>) =>
    api('/lodging/bookings', BookingDetail, { method: 'POST', body, workspaceId: ws }),
  );
}

/** Edit dates, rooms, guests or price; the server re-quotes and re-takes nights atomically. */
export function useUpdateBooking() {
  return useBookingMutation((ws, { id, body }: { id: string; body: UpdateBookingRequest }) =>
    api(`/lodging/bookings/${id}`, BookingDetail, { method: 'PATCH', body, workspaceId: ws }),
  );
}

/** Confirm, check in/out, cancel, no-show, extend a hold or remove a block. */
export function useChangeBookingStatus() {
  return useBookingMutation(
    (ws, { id, body }: { id: string; body: z.input<typeof BookingStatusRequest> }) =>
      api(`/lodging/bookings/${id}/status`, BookingDetail, {
        method: 'POST',
        body,
        workspaceId: ws,
      }),
  );
}

export type LodgingConflictReason = 'NIGHTS_TAKEN' | 'STALE_VERSION' | 'HOLD_EXPIRED';
const REASONS: readonly string[] = ['NIGHTS_TAKEN', 'STALE_VERSION', 'HOLD_EXPIRED'];

/**
 * Reads a lodging 409: `NIGHTS_TAKEN` (with the blocking booking codes) or
 * `STALE_VERSION` (someone else saved first) or `HOLD_EXPIRED` (the hold lapsed before the
 * action). `reason` is null for any other
 * error, including a 409 without a reason (illegal status move, reused key).
 */
export function lodgingConflict(error: unknown): {
  reason: LodgingConflictReason | null;
  codes: string[];
} {
  if (!(error instanceof ApiClientError) || error.code !== 'CONFLICT')
    return { reason: null, codes: [] };
  const raw = error.details?.['reason'];
  const reason =
    typeof raw === 'string' && REASONS.includes(raw) ? (raw as LodgingConflictReason) : null;
  const codes = error.details?.['codes'];
  return {
    reason,
    codes: Array.isArray(codes) ? codes.filter((c): c is string => typeof c === 'string') : [],
  };
}
