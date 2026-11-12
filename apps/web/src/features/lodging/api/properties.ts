import {
  type CreateOverrideRequest,
  type PropertyInput,
  PropertyDto,
  PropertyList,
  type PutRatesRequest,
  type ReplaceUnitsRequest,
  type UpdateOverrideRequest,
  type UpdatePropertyRequest,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { withQuery } from '@/lib/url';
import { useWorkspaceId } from '@/lib/use-workspace';

import { lodgingKeys } from './keys';

/** Properties with units and today's occupancy (`GET /lodging/properties`). */
export function useProperties() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: lodgingKeys.properties(ws),
    queryFn: async ({ signal }) =>
      (await api('/lodging/properties', PropertyList, { workspaceId: ws, signal })).data,
    enabled: Boolean(ws),
  });
}

/** One property with units, rates and surcharges. */
export function useProperty(id: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: lodgingKeys.property(ws, id ?? ''),
    queryFn: ({ signal }) =>
      api(`/lodging/properties/${id}`, PropertyDto, { workspaceId: ws, signal }),
    enabled: Boolean(ws && id),
  });
}

/** Every lodging mutation refreshes the whole lodging cache (calendar, lists, quotes). */
function usePropertyMutation<V>(mutationFn: (ws: string, vars: V) => Promise<PropertyDto>) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) => mutationFn(ws, vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: lodgingKeys.all(ws) }),
  });
}

export function useCreateProperty() {
  return usePropertyMutation((ws, body: PropertyInput) =>
    api('/lodging/properties', PropertyDto, { method: 'POST', body, workspaceId: ws }),
  );
}

export function useUpdateProperty() {
  return usePropertyMutation((ws, { id, body }: { id: string; body: UpdatePropertyRequest }) =>
    api(`/lodging/properties/${id}`, PropertyDto, { method: 'PATCH', body, workspaceId: ws }),
  );
}

/** Replace the room list of a `rooms` property. */
export function useReplaceUnits() {
  return usePropertyMutation(
    (ws, { id, body }: { id: string; body: z.input<typeof ReplaceUnitsRequest> }) =>
      api(`/lodging/properties/${id}/units`, PropertyDto, {
        method: 'PUT',
        body,
        workspaceId: ws,
      }),
  );
}

/** Replace the weekday rates and surcharges as a whole. */
export function usePutRates() {
  return usePropertyMutation(
    (ws, { id, body }: { id: string; body: z.input<typeof PutRatesRequest> }) =>
      api(`/lodging/properties/${id}/rates`, PropertyDto, { method: 'PUT', body, workspaceId: ws }),
  );
}

export function useCreateOverride() {
  return usePropertyMutation(
    (ws, { id, body }: { id: string; body: z.input<typeof CreateOverrideRequest> }) =>
      api(`/lodging/properties/${id}/overrides`, PropertyDto, {
        method: 'POST',
        body,
        workspaceId: ws,
      }),
  );
}

export function useUpdateOverride() {
  return usePropertyMutation(
    (ws, { id, rateId, body }: { id: string; rateId: string; body: UpdateOverrideRequest }) =>
      api(`/lodging/properties/${id}/overrides/${rateId}`, PropertyDto, {
        method: 'PATCH',
        body,
        workspaceId: ws,
      }),
  );
}

export function useDeleteOverride() {
  return usePropertyMutation(
    (ws, { id, rateId, version }: { id: string; rateId: string; version: number }) =>
      api(withQuery(`/lodging/properties/${id}/overrides/${rateId}`, { version }), PropertyDto, {
        method: 'DELETE',
        workspaceId: ws,
      }),
  );
}

/**
 * Hard delete of a property that has never had a booking (otherwise 409
 * `details.reason = 'property_has_bookings'`). Drops its cached detail and refreshes lodging.
 */
export function useDeleteProperty() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/lodging/properties/${id}`, z.null(), { method: 'DELETE', workspaceId: ws }),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: lodgingKeys.property(ws, id) });
      void qc.invalidateQueries({ queryKey: lodgingKeys.all(ws) });
    },
  });
}
