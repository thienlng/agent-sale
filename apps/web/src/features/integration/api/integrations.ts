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
import { useEffect, useState } from 'react';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
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

export function useIntegrations({ enabled = true }: { enabled?: boolean } = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: listKey(ws),
    queryFn: () => api('/integrations', IntegrationListResponse),
    enabled: Boolean(ws) && enabled,
    refetchInterval: (query) =>
      kiotVietConnection(query.state.data)?.status === 'syncing' ? SYNC_POLL_MS : false,
  });
}

/**
 * The KiotViet store other screens link to (products list and form): the connection's retailer and
 * last sync, `null` when not connected, `undefined` while unknown (loading, failed, or a member
 * without `catalog.manage`, who may not read integrations).
 */
export function usePmsLink(): { retailer: string; lastSyncAt: string | null } | null | undefined {
  const canView = useCan('catalog.manage');
  const list = useIntegrations({ enabled: canView });
  if (!list.data) return undefined;
  const connection = kiotVietConnection(list.data);
  return connection ? { retailer: connection.retailer, lastSyncAt: connection.lastSyncAt } : null;
}

export function useKiotVietLog(enabled: boolean, poll: boolean) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  // Polling stops with the sync; read once more so its final entry (done / failed) shows up.
  const [wasPolling, setWasPolling] = useState(poll);
  useEffect(() => {
    if (wasPolling && !poll) void qc.invalidateQueries({ queryKey: logKey(ws) });
    if (wasPolling !== poll) setWasPolling(poll);
  }, [poll, wasPolling, qc, ws]);
  return useQuery({
    queryKey: logKey(ws),
    queryFn: async () => (await api('/integrations/kiotviet/log', SyncLogResponse)).entries,
    enabled: Boolean(ws) && enabled,
    refetchInterval: poll ? SYNC_POLL_MS : false,
  });
}

/** Checks credentials, lists branches and previews the first sync. Stores nothing. */
/** Mutations whose variables carry the client secret: drop them from the cache at once. */
const SECRET_SAFE = { gcTime: 0 } as const;

export function useTestKiotViet() {
  return useMutation({
    ...SECRET_SAFE,
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
    ...SECRET_SAFE,
    mutationFn: (body: ConnectKiotVietRequest) =>
      api('/integrations/kiotviet', ConnectionDto, { method: 'POST', body }),
    onSettled: refresh,
  });
}

export function useUpdateKiotViet() {
  const refresh = useRefresh();
  return useMutation({
    ...SECRET_SAFE,
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
