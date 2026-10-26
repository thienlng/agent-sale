import {
  type CreateTrainingItemRequest,
  TrainingItemDto,
  type UpdateTrainingItemRequest,
  type UploadBotImageRequest,
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
    mutationFn: ({ id, ...input }: z.input<typeof CreateTrainingItemRequest> & { id?: string }) =>
      id
        ? api(`/bots/${botId}/training-items/${id}`, TrainingItemDto, {
            method: 'PATCH',
            body: {
              title: input.title,
              content: input.content,
              trigger: input.trigger,
              notes: input.notes,
              mediaUrl: input.mediaUrl,
              // Only scenarios are grouped into sections.
              ...(input.kind === 'scenario' && input.section ? { section: input.section } : {}),
              // Only media items live in folders; other kinds never send it.
              ...(input.kind === 'media' ? { folderId: input.folderId } : {}),
            } satisfies UpdateTrainingItemRequest,
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

/** Switches a rule on or off without touching the rest of the item. */
export function useToggleTrainingItem(botId: string) {
  const ws = useWorkspaceId();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api(`/bots/${botId}/training-items/${id}`, TrainingItemDto, {
        method: 'PATCH',
        body: { enabled } satisfies UpdateTrainingItemRequest,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['training', ws, botId] });
    },
  });
}

/** Adds the starter rule set the bot is missing (route in `bot.routes.ts`; answers like the item list). */
export function useAddStarterRules(botId: string) {
  const ws = useWorkspaceId();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (
        await api(`/bots/${botId}/training-items/starter-rules`, TrainingItemList, {
          method: 'POST',
        })
      ).data,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['training', ws, botId] });
    },
  });
}

/** Uploads a PNG/JPEG/WebP image to the bot's library (kind `media`). */
export function useUploadBotImage(botId: string) {
  const ws = useWorkspaceId();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UploadBotImageRequest) =>
      api(`/bots/${botId}/media-upload`, TrainingItemDto, { method: 'POST', body }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['training', ws, botId] });
    },
  });
}
