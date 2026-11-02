import {
  ApiKeyDto,
  ApiKeyList,
  CreatedApiKey,
  WebhookDeliveryDto,
  WebhookDeliveryPage,
  WebhookEndpointDto,
  WebhookEndpointList,
  WebhookEndpointWithSecret,
  type CreateApiKeyRequest,
  type CreateWebhookEndpointRequest,
  type UpdateWebhookEndpointRequest,
  type WebhookDeliveryStatus,
} from '@agent-sales/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { withQuery } from '@/lib/url';
import { useWorkspaceId } from '@/lib/use-workspace';

/** Where the public OpenAPI document lives (routes callable with an API key only, ADR-022 §1). */
export const PUBLIC_OPENAPI_URL = '/api/v1/public/openapi.json';

const keysKey = (ws: string) => ['ws', ws, 'developer', 'api-keys'] as const;
const endpointsKey = (ws: string) => ['ws', ws, 'developer', 'webhook-endpoints'] as const;
const deliveriesKey = (ws: string, endpointId: string) =>
  ['ws', ws, 'developer', 'deliveries', endpointId] as const;

const path = (id: string) => encodeURIComponent(id);

/**
 * Responses with a key or signing secret in them: never kept in the query cache longer than the
 * dialog that shows them once.
 */
const SECRET_SAFE = { gcTime: 0 } as const;

export function useApiKeys({ enabled = true }: { enabled?: boolean } = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: keysKey(ws),
    queryFn: async () => (await api('/api-keys', ApiKeyList)).data,
    enabled: Boolean(ws) && enabled,
  });
}

export function useCreateApiKey() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    ...SECRET_SAFE,
    mutationFn: (body: CreateApiKeyRequest) =>
      api('/api-keys', CreatedApiKey, { method: 'POST', body }),
    onSettled: () => qc.invalidateQueries({ queryKey: keysKey(ws) }),
  });
}

export function useRevokeApiKey() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api-keys/${path(id)}/revoke`, ApiKeyDto, { method: 'POST' }),
    onSettled: () => qc.invalidateQueries({ queryKey: keysKey(ws) }),
  });
}

export function useWebhookEndpoints({ enabled = true }: { enabled?: boolean } = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: endpointsKey(ws),
    queryFn: async () => (await api('/webhook-endpoints', WebhookEndpointList)).data,
    enabled: Boolean(ws) && enabled,
  });
}

function useRefreshEndpoints() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: endpointsKey(ws) });
}

export function useCreateWebhookEndpoint() {
  const refresh = useRefreshEndpoints();
  return useMutation({
    ...SECRET_SAFE,
    mutationFn: (body: CreateWebhookEndpointRequest) =>
      api('/webhook-endpoints', WebhookEndpointWithSecret, { method: 'POST', body }),
    onSettled: refresh,
  });
}

export function useUpdateWebhookEndpoint() {
  const refresh = useRefreshEndpoints();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateWebhookEndpointRequest }) =>
      api(`/webhook-endpoints/${path(id)}`, WebhookEndpointDto, { method: 'PATCH', body }),
    onSettled: refresh,
  });
}

export function useDeleteWebhookEndpoint() {
  const refresh = useRefreshEndpoints();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/webhook-endpoints/${path(id)}`, z.null(), { method: 'DELETE' }),
    onSettled: refresh,
  });
}

export function useRotateWebhookSecret() {
  const refresh = useRefreshEndpoints();
  return useMutation({
    ...SECRET_SAFE,
    mutationFn: (id: string) =>
      api(`/webhook-endpoints/${path(id)}/rotate-secret`, WebhookEndpointWithSecret, {
        method: 'POST',
      }),
    onSettled: refresh,
  });
}

export function useSendTestEvent() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/webhook-endpoints/${path(id)}/test`, WebhookDeliveryDto, { method: 'POST' }),
    onSettled: (_data, _error, id) => qc.invalidateQueries({ queryKey: deliveriesKey(ws, id) }),
  });
}

/** The delivery log of one endpoint, newest first, page by page with the server's cursor. */
export function useWebhookDeliveries(
  endpointId: string | null,
  status: WebhookDeliveryStatus | undefined,
) {
  const ws = useWorkspaceId();
  return useInfiniteQuery({
    queryKey: [...deliveriesKey(ws, endpointId ?? ''), status ?? 'all'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api(
        withQuery(`/webhook-endpoints/${path(endpointId ?? '')}/deliveries`, {
          status,
          limit: 30,
          cursor: pageParam,
        }),
        WebhookDeliveryPage,
      ),
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
    enabled: Boolean(ws) && Boolean(endpointId),
  });
}

export function useResendDelivery() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (delivery: { id: string; endpointId: string }) =>
      api(`/webhook-deliveries/${path(delivery.id)}/resend`, WebhookDeliveryDto, {
        method: 'POST',
      }),
    onSettled: (_data, _error, delivery) =>
      qc.invalidateQueries({ queryKey: deliveriesKey(ws, delivery.endpointId) }),
  });
}
