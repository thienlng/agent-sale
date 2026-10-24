import { TrainingHistoryList } from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useWorkspaceId } from '@/lib/use-workspace';

/** Same cache entry as the training pages use, so their edits refresh it. */
const historyKey = (ws: string, botId: string) => ['training', ws, botId, 'history'] as const;

/** Latest 200 changes of the bot's settings and training data, newest first. */
export function useEditHistory(botId: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: historyKey(ws, botId),
    queryFn: async () => (await api(`/bots/${botId}/training-history`, TrainingHistoryList)).data,
    enabled: Boolean(ws),
  });
}

/** Puts back the state before an entry; everything it may touch is refetched. */
export function useRestoreHistory(botId: string) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (historyId: string) =>
      api(`/bots/${botId}/training-history/${historyId}/restore`, z.null(), { method: 'POST' }),
    onSuccess: () => {
      for (const queryKey of [
        queryKeys.bot(ws, botId),
        queryKeys.bots(ws),
        queryKeys.faqs(ws, botId),
        queryKeys.readiness(ws, botId),
        ['training', ws, botId],
      ]) {
        void qc.invalidateQueries({ queryKey });
      }
    },
  });
}
