import {
  BotDto,
  BotReadiness,
  ChannelListResponse,
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
  const listKey = queryKeys.bots(ws);
  return useMutation({
    mutationKey: ['update-bot', ws, botId],
    scope: { id: `update-bot:${ws}:${botId}` },
    mutationFn: (change: UpdateBotRequest) =>
      api(`/bots/${botId}`, BotDto, { method: 'PATCH', body: change }),
    onMutate: async (change) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: key }),
        qc.cancelQueries({ queryKey: listKey, exact: true }),
      ]);
      const previous =
        qc.getQueryData<BotDto>(key) ??
        qc.getQueryData<BotDto[]>(listKey)?.find((bot) => bot.id === botId);
      if (previous) {
        const optimistic = {
          ...previous,
          ...(change.name !== undefined ? { name: change.name } : {}),
          ...(change.isActive !== undefined ? { isActive: change.isActive } : {}),
        };
        qc.setQueryData<BotDto>(key, optimistic);
        qc.setQueryData<BotDto[]>(listKey, (list) =>
          list?.map((bot) => (bot.id === botId ? optimistic : bot)),
        );
      }
      return { previous };
    },
    onError: (_e, _c, ctx) => {
      const previous = ctx?.previous;
      if (previous) {
        qc.setQueryData(key, previous);
        qc.setQueryData<BotDto[]>(listKey, (list) =>
          list?.map((bot) => (bot.id === botId ? previous : bot)),
        );
      }
    },
    onSuccess: (bot) => {
      qc.setQueryData(key, bot);
      qc.setQueryData<BotDto[]>(queryKeys.bots(ws), (list) =>
        list?.map((b) => (b.id === bot.id ? bot : b)),
      );
      void qc.invalidateQueries({ queryKey: ['bots', ws] });
      void qc.invalidateQueries({ queryKey: [...key, 'inbox'] });
      void qc.invalidateQueries({ queryKey: queryKeys.readiness(ws, botId) });
      void qc.invalidateQueries({ queryKey: ['training', ws, botId, 'history'] });
    },
  });
}

/** Soft delete. Drops the bot from the cached list and refreshes pages that may have pointed at it. */
export function useDeleteBot() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (botId: string) => api(`/bots/${botId}`, z.null(), { method: 'DELETE' }),
    onSuccess: (_void, botId) => {
      qc.setQueryData<BotDto[]>(queryKeys.bots(ws), (list) => list?.filter((b) => b.id !== botId));
      qc.removeQueries({ queryKey: queryKeys.bot(ws, botId) });
      void qc.invalidateQueries({ queryKey: queryKeys.bots(ws) });
      void qc.invalidateQueries({ queryKey: ['channels', ws] });
      void qc.invalidateQueries({ queryKey: ['bots', ws] });
    },
  });
}

/** Ids of bots that at least one connected page replies with (the delete dialog warns about them). */
export function useBotsInUse(enabled: boolean) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['channels', ws],
    queryFn: () => api('/channels', ChannelListResponse),
    enabled: Boolean(ws) && enabled,
    select: (r) => new Set(r.data.filter((c) => c.botId).map((c) => c.botId as string)),
  });
}
