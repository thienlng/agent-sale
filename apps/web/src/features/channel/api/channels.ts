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
export function useSelectAccounts() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, externalIds }: { id: string; externalIds: string[] }) =>
      api(`/channels/discoveries/${id}/select`, z.object({ data: z.array(ChannelConnectionDto) }), {
        method: 'POST',
        body: { externalIds },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels', ws] }),
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
