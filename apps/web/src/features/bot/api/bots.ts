import {
  BotDto,
  BotReadiness,
  type CreateBotRequest,
  type UpdateBotRequest,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useWorkspaceId } from '@/lib/use-workspace';

const BotList = z.object({ data: z.array(BotDto) });

export function useBots() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.bots(ws),
    queryFn: async () => (await api('/bots', BotList)).data,
    enabled: Boolean(ws),
  });
}

export function useBot(botId: string) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useQuery({
    queryKey: queryKeys.bot(ws, botId),
    queryFn: () => api(`/bots/${botId}`, BotDto),
    // The list already has the bot: show it instantly, refresh in the background.
    initialData: () => qc.getQueryData<BotDto[]>(queryKeys.bots(ws))?.find((b) => b.id === botId),
    enabled: Boolean(ws),
  });
}

export function useReadiness(botId: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.readiness(ws, botId),
    queryFn: () => api(`/bots/${botId}/readiness`, BotReadiness),
    enabled: Boolean(ws),
  });
}

export function useCreateBot() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBotRequest) => api('/bots', BotDto, { method: 'POST', body: input }),
    onSuccess: (bot) => {
      qc.setQueryData<BotDto[]>(queryKeys.bots(ws), (list) => [...(list ?? []), bot]);
      qc.setQueryData(queryKeys.bot(ws, bot.id), bot);
    },
  });
}

/** Optimistic: the switch and form reflect the change at once; rolled back on error. */
export function useUpdateBot(botId: string) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const key = queryKeys.bot(ws, botId);
  return useMutation({
    mutationFn: (change: UpdateBotRequest) =>
      api(`/bots/${botId}`, BotDto, { method: 'PATCH', body: change }),
    onMutate: async (change) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BotDto>(key);
      if (previous) {
        qc.setQueryData<BotDto>(key, {
          ...previous,
          ...(change.name !== undefined ? { name: change.name } : {}),
          ...(change.isActive !== undefined ? { isActive: change.isActive } : {}),
        });
      }
      return { previous };
    },
    onError: (_e, _c, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSuccess: (bot) => {
      qc.setQueryData(key, bot);
      qc.setQueryData<BotDto[]>(queryKeys.bots(ws), (list) =>
        list?.map((b) => (b.id === bot.id ? bot : b)),
      );
      void qc.invalidateQueries({ queryKey: queryKeys.readiness(ws, botId) });
      void qc.invalidateQueries({ queryKey: ['training', ws, botId, 'history'] });
    },
  });
}
