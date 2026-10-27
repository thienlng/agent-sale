import {
  type AnalyticsQuery,
  AnalyticsResponse,
  ChannelListResponse,
  CrmAssigneeList,
  CrmOptionList,
  DefinitionsResponse,
  type DrilldownRequest,
  DrilldownResponse,
  TagList,
} from '@agent-sales/contracts';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

export function useDefinitions() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['ws', ws, 'analytics', 'definitions'],
    queryFn: () => api('/analytics/definitions', DefinitionsResponse),
    enabled: Boolean(ws),
    staleTime: Infinity,
  });
}

/** One statistics query. Keeps the previous answer on screen while the next one loads. */
export function useStatistics(group: string, query: AnalyticsQuery | null) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['ws', ws, 'analytics', 'query', group, query],
    queryFn: ({ signal }) =>
      api('/analytics/query', AnalyticsResponse, {
        method: 'POST',
        body: query,
        workspaceId: ws,
        signal,
      }),
    enabled: Boolean(ws && query),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

/** The rows behind one number, newest first, a page at a time. */
export function useDrilldown(request: DrilldownRequest | null) {
  const ws = useWorkspaceId();
  return useInfiniteQuery({
    queryKey: ['ws', ws, 'analytics', 'drilldown', request],
    queryFn: ({ pageParam }) =>
      api('/analytics/drilldown', DrilldownResponse, {
        method: 'POST',
        body: { ...request, ...(pageParam ? { cursor: pageParam } : {}) },
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(ws && request),
  });
}

// Names for the ids the numbers speak of. Own calls: features never import each other.

export function useAssignees() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['ws', ws, 'analytics', 'assignees'],
    queryFn: async () => (await api('/crm/assignees', CrmAssigneeList)).data,
    enabled: Boolean(ws),
  });
}

export function usePages(enabled = true) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['ws', ws, 'analytics', 'pages'],
    queryFn: async () => (await api('/channels', ChannelListResponse)).data,
    enabled: Boolean(ws) && enabled,
  });
}

export function useTagNames() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['ws', ws, 'analytics', 'tags'],
    queryFn: async () => (await api('/crm/tags', TagList)).data,
    enabled: Boolean(ws),
  });
}

export function useStatusNames() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['ws', ws, 'analytics', 'statuses'],
    queryFn: async () => (await api('/crm/statuses', CrmOptionList)).data,
    enabled: Boolean(ws),
  });
}
