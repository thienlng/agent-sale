import { BotDto, type UpdateBotRequest } from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useWorkspaceId } from '@/lib/use-workspace';

type ProfilePatch = NonNullable<NonNullable<UpdateBotRequest['settings']>['profile']>;

/**
 * The bot (industry + profile) behind the information form. It shares the bot feature's
 * cache entry on purpose, without importing that feature.
 */
export function useBotProfile(botId: string) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useQuery({
    queryKey: queryKeys.bot(ws, botId),
    queryFn: () => api(`/bots/${botId}`, BotDto),
    initialData: () => qc.getQueryData<BotDto[]>(queryKeys.bots(ws))?.find((b) => b.id === botId),
    enabled: Boolean(ws),
  });
}

type SettingsPatch = NonNullable<UpdateBotRequest['settings']>;

function useSaveBotSettingsPatch<T>(botId: string, toSettings: (value: T) => SettingsPatch) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: T) =>
      api(`/bots/${botId}`, BotDto, {
        method: 'PATCH',
        body: { settings: toSettings(value) } satisfies UpdateBotRequest,
      }),
    onSuccess: (bot) => qc.setQueryData(queryKeys.bot(ws, botId), bot),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.bot(ws, botId) });
      void qc.invalidateQueries({ queryKey: queryKeys.bots(ws) });
      void qc.invalidateQueries({ queryKey: queryKeys.readiness(ws, botId) });
    },
  });
}

/** Sends only the changed profile keys ('' clears one); the server merges them. */
export function useSaveBotProfile(botId: string) {
  return useSaveBotSettingsPatch(botId, (profile: ProfilePatch) => ({ profile }));
}

/** Sends only the changed top-level settings keys (the personality); the server merges them. */
export function useSaveBotSettings(botId: string) {
  return useSaveBotSettingsPatch(botId, (settings: SettingsPatch) => settings);
}
