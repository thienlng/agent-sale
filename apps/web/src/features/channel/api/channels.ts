import {
  BotDto,
  ChannelConnectionDto,
  ChannelListResponse,
  ConnectChannelResponse,
  DiscoveryDto,
  type CreateWebsiteRequest,
  type MetaProvider,
  type UpdateChannelRequest,
  type UpdateWebsiteRequest,
} from '@agent-sales/contracts';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { queryKeys } from '@/lib/query-keys';
import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';
/** Every assignment path refreshes the global list, bot setup/readiness and inbox context. */
function invalidateConnectionViews(qc: QueryClient, ws: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['channels', ws] }),
    qc.invalidateQueries({ queryKey: ['inbox', ws] }),
    qc.invalidateQueries({ queryKey: queryKeys.bots(ws) }),
  ]);
}

export function useChannels() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['channels', ws],
    queryFn: () => api('/channels', ChannelListResponse),
    enabled: Boolean(ws),
  });
}
export function useChannelBots() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.bots(ws),
    queryFn: async () => (await api('/bots', z.object({ data: z.array(BotDto) }))).data,
    enabled: Boolean(ws),
  });
}
export function startConnection(provider: MetaProvider) {
  return api(`/channels/${provider}/connect`, ConnectChannelResponse, { method: 'POST' });
}
export function useDiscovery(id: string | null) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['channel-discovery', ws, id],
    queryFn: () => api(`/channels/discoveries/${id}`, DiscoveryDto),
    enabled: Boolean(ws && id),
    retry: false,
  });
}
export interface SelectAccountsResult {
  connections: ChannelConnectionDto[];
  /** Pages that were connected but could not be bound to the requested bot. */
  bindFailed: number;
}
/**
 * Saves the pages chosen in the discovery dialog. With `bindBotId` (bot integrations screen)
 * each newly connected page is bound to that bot right after, so the bot answers it at once.
 */
export function useSelectAccounts(bindBotId?: string) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      externalIds,
    }: {
      id: string;
      externalIds: string[];
    }): Promise<SelectAccountsResult> => {
      const { data } = await api(
        `/channels/discoveries/${id}/select`,
        z.object({ data: z.array(ChannelConnectionDto) }),
        { method: 'POST', body: { externalIds } },
      );
      if (!bindBotId) return { connections: data, bindFailed: 0 };
      const targets = data.filter((c) => c.status === 'connected' && c.botId !== bindBotId);
      const results = await Promise.allSettled(
        targets.map((c) =>
          api(`/channels/${c.id}`, ChannelConnectionDto, {
            method: 'PATCH',
            body: { botId: bindBotId } satisfies UpdateChannelRequest,
          }),
        ),
      );
      return {
        connections: data,
        bindFailed: results.filter((r) => r.status === 'rejected').length,
      };
    },
    onSettled: () => invalidateConnectionViews(qc, ws),
  });
}
/** Applies changes and returns only the failed page ids, so retries do not repeat successes. */
export function useBulkUpdateChannels() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (changes: { id: string; body: UpdateChannelRequest }[]) => {
      const results = await Promise.allSettled(
        changes.map(({ id, body }) =>
          api(`/channels/${id}`, ChannelConnectionDto, { method: 'PATCH', body }),
        ),
      );
      return changes
        .filter((_change, index) => results[index]?.status === 'rejected')
        .map((change) => change.id);
    },
    onSettled: () => invalidateConnectionViews(qc, ws),
  });
}
export function useUpdateChannel() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateChannelRequest }) =>
      api(`/channels/${id}`, ChannelConnectionDto, { method: 'PATCH', body }),
    onSuccess: () => invalidateConnectionViews(qc, ws),
  });
}

export function useCreateWebsite() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWebsiteRequest) =>
      api('/channels/website', ChannelConnectionDto, { method: 'POST', body }),
    onSuccess: () => invalidateConnectionViews(qc, ws),
  });
}
/** Partial update: send only the fields that changed (settings, name, enabled). */
export function useUpdateWebsite() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateWebsiteRequest }) =>
      api(`/channels/${id}/website`, ChannelConnectionDto, { method: 'PATCH', body }),
    onSuccess: () => invalidateConnectionViews(qc, ws),
  });
}
