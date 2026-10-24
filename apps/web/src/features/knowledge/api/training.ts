import {
  type CreateTrainingItemRequest,
  TrainingItemDto,
  TrainingItemList,
  TrainingHistoryList,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

export function useTrainingItems(botId: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['training', ws, botId, 'items'],
    queryFn: async () => (await api(`/bots/${botId}/training-items`, TrainingItemList)).data,
    enabled: Boolean(ws),
  });
}
export function useTrainingHistory(botId: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['training', ws, botId, 'history'],
    queryFn: async () => (await api(`/bots/${botId}/training-history`, TrainingHistoryList)).data,
    enabled: Boolean(ws),
  });
}
export function useSaveTrainingItem(botId: string) {
  const ws = useWorkspaceId();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: CreateTrainingItemRequest & { id?: string }) =>
      id
        ? api(`/bots/${botId}/training-items/${id}`, TrainingItemDto, {
            method: 'PATCH',
            body: {
              title: input.title,
              content: input.content,
              trigger: input.trigger,
              notes: input.notes,
              mediaUrl: input.mediaUrl,
            },
          })
        : api(`/bots/${botId}/training-items`, TrainingItemDto, { method: 'POST', body: input }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['training', ws, botId] });
    },
  });
}
export function useDeleteTrainingItem(botId: string) {
  const ws = useWorkspaceId();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/bots/${botId}/training-items/${id}`, z.null(), { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['training', ws, botId] });
    },
  });
}
