import { BotPropertiesDto, LodgingSettings } from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

import { lodgingKeys } from './keys';

/** Lodging settings of the business (hold minutes). */
export function useLodgingSettings() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: lodgingKeys.settings(ws),
    queryFn: ({ signal }) => api('/lodging/settings', LodgingSettings, { workspaceId: ws, signal }),
    enabled: Boolean(ws),
  });
}

export function useUpdateLodgingSettings() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LodgingSettings) =>
      api('/lodging/settings', LodgingSettings, { method: 'PATCH', body, workspaceId: ws }),
    onSuccess: () => qc.invalidateQueries({ queryKey: lodgingKeys.all(ws) }),
  });
}

/** Properties a bot sells; all active properties while the bot has no stored selection. */
export function useBotProperties(botId: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: lodgingKeys.botProperties(ws, botId ?? ''),
    queryFn: async ({ signal }) =>
      (
        await api(`/lodging/bots/${botId}/properties`, BotPropertiesDto, {
          workspaceId: ws,
          signal,
        })
      ).propertyIds,
    enabled: Boolean(ws && botId),
  });
}

/** Replace the properties a bot sells; `[]` means every property again. */
export function useSetBotProperties() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ botId, propertyIds }: { botId: string; propertyIds: string[] }) =>
      api(`/lodging/bots/${botId}/properties`, BotPropertiesDto, {
        method: 'PUT',
        body: { propertyIds },
        workspaceId: ws,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: lodgingKeys.all(ws) }),
  });
}
