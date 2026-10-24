import {
  type CreateFaqRequest,
  type ImportFaqsRequest,
  FaqDto,
  FaqListResponse,
  type UpdateFaqRequest,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useWorkspaceId } from '@/lib/use-workspace';

export function useFaqs(botId: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.faqs(ws, botId),
    queryFn: async () => (await api(`/bots/${botId}/faqs`, FaqListResponse)).data,
    enabled: Boolean(ws),
  });
}

/** FAQ changes also move the bot's readiness (FAQ count), so it is refreshed too. */
function useFaqMutation<TInput>(botId: string, run: (input: TInput) => Promise<unknown>) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.faqs(ws, botId) });
      void qc.invalidateQueries({ queryKey: queryKeys.readiness(ws, botId) });
      void qc.invalidateQueries({ queryKey: ['training', ws, botId, 'history'] });
    },
  });
}

export function useSaveFaq(botId: string) {
  return useFaqMutation(botId, (input: { id?: string } & CreateFaqRequest) =>
    input.id
      ? api(`/bots/${botId}/faqs/${input.id}`, FaqDto, {
          method: 'PATCH',
          body: { question: input.question, answer: input.answer } satisfies UpdateFaqRequest,
        })
      : api(`/bots/${botId}/faqs`, FaqDto, {
          method: 'POST',
          body: { question: input.question, answer: input.answer },
        }),
  );
}

/** Optimistic: the row disappears at once and comes back if the server refuses. */
export function useDeleteFaq(botId: string) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const key = queryKeys.faqs(ws, botId);
  return useMutation({
    mutationFn: (faqId: string) =>
      api(`/bots/${botId}/faqs/${faqId}`, z.null(), { method: 'DELETE' }),
    onMutate: async (faqId) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<FaqDto[]>(key);
      qc.setQueryData<FaqDto[]>(key, (list) => list?.filter((f) => f.id !== faqId));
      return { previous };
    },
    onError: (_e, _id, ctx) => qc.setQueryData(key, ctx?.previous),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: queryKeys.readiness(ws, botId) });
      void qc.invalidateQueries({ queryKey: ['training', ws, botId, 'history'] });
    },
  });
}

export function useImportFaqs(botId: string) {
  return useFaqMutation(botId, (body: ImportFaqsRequest) =>
    api(`/bots/${botId}/faqs/import`, FaqListResponse, { method: 'POST', body }),
  );
}
