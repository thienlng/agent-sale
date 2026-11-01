import {
  ConnectionDto,
  IntegrationListResponse,
  KiotVietTestResponse,
  SyncLogResponse,
  type ConnectKiotVietRequest,
  type KiotVietCredentials,
  type UpdateKiotVietRequest,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useWorkspaceId } from '@/lib/use-workspace';

/** While a sync runs the connection view polls, so progress moves without a reload. */
export const SYNC_POLL_MS = 3000;

const listKey = (ws: string) => ['integrations', ws] as const;
const logKey = (ws: string) => ['integrations', ws, 'kiotviet-log'] as const;

/** The live KiotViet connection in a list response, or null when not connected. */
export function kiotVietConnection(
  list: IntegrationListResponse | undefined,
): ConnectionDto | null {
  const connection = list?.providers.find((p) => p.provider === 'kiotviet')?.connection ?? null;
  return connection && connection.status !== 'disconnected' ? connection : null;
}

export function useIntegrations() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: listKey(ws),
    queryFn: () => api('/integrations', IntegrationListResponse),
    enabled: Boolean(ws),
    refetchInterval: (query) =>
      kiotVietConnection(query.state.data)?.status === 'syncing' ? SYNC_POLL_MS : false,
  });
}

export function useKiotVietLog(enabled: boolean, poll: boolean) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: logKey(ws),
    queryFn: async () => (await api('/integrations/kiotviet/log', SyncLogResponse)).entries,
    enabled: Boolean(ws) && enabled,
    refetchInterval: poll ? SYNC_POLL_MS : false,
  });
}

/** Checks credentials, lists branches and previews the first sync. Stores nothing. */
export function useTestKiotViet() {
  return useMutation({
    mutationFn: (body: KiotVietCredentials) =>
      api('/integrations/kiotviet/test', KiotVietTestResponse, { method: 'POST', body }),
  });
}

/** Every change refreshes the list, the log and the catalog the sync writes into. */
function useRefresh() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: listKey(ws) }),
      qc.invalidateQueries({ queryKey: queryKeys.products(ws) }),
    ]);
}

export function useConnectKiotViet() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: ConnectKiotVietRequest) =>
      api('/integrations/kiotviet', ConnectionDto, { method: 'POST', body }),
    onSettled: refresh,
  });
}

export function useUpdateKiotViet() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: UpdateKiotVietRequest) =>
      api('/integrations/kiotviet', ConnectionDto, { method: 'PATCH', body }),
    onSettled: refresh,
  });
}

export function useSyncKiotViet() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: () => api('/integrations/kiotviet/sync', z.null(), { method: 'POST' }),
    onSettled: refresh,
  });
}

export function useDisconnectKiotViet() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: () => api('/integrations/kiotviet', z.null(), { method: 'DELETE' }),
    onSettled: refresh,
  });
}
