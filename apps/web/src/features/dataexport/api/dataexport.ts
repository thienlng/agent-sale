import {
  DataExportDto,
  DataExportLink,
  DataExportList,
  type CreateDataExportBody,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useWorkspaceId } from '@/lib/use-workspace';

/** How often the list refreshes while an export is still being prepared. */
export const EXPORT_POLL_MS = 5_000;

/** An export the worker has not finished yet. */
export const isInProgress = (e: DataExportDto) => e.status === 'queued' || e.status === 'running';

/** Recent whole-workspace exports and today's quota; polls while one is being prepared. */
export function useDataExports({ enabled = true }: { enabled?: boolean } = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.dataExports(ws),
    queryFn: () => api('/data-exports', DataExportList),
    enabled: Boolean(ws) && enabled,
    refetchInterval: (query) =>
      query.state.data?.data.some(isInProgress) ? EXPORT_POLL_MS : false,
  });
}

export function useStartDataExport() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDataExportBody) =>
      api('/data-exports', DataExportDto, { method: 'POST', body }),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.dataExports(ws) }),
  });
}

/** A one-time, 5-minute download link (no auth header needed to follow it). */
export function useDataExportLink() {
  return useMutation({
    gcTime: 0,
    mutationFn: (id: string) =>
      api(`/data-exports/${encodeURIComponent(id)}/link`, DataExportLink, { method: 'POST' }),
  });
}
