import {
  BotDto,
  ChannelConnectionDto,
  ChannelListResponse,
  ConnectChannelResponse,
  DiscoveryDto,
  type MetaProvider,
  type UpdateChannelRequest,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';
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
    queryKey: ['bots', ws],
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
    onSettled: () => qc.invalidateQueries({ queryKey: ['channels', ws] }),
  });
}
/** Applies one change to several pages; resolves with the number of failed updates. */
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
      return results.filter((r) => r.status === 'rejected').length;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['channels', ws] }),
  });
}
export function useUpdateChannel() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateChannelRequest }) =>
      api(`/channels/${id}`, ChannelConnectionDto, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels', ws] }),
  });
}
