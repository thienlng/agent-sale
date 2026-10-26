import {
  ActionDto,
  ActionListResponse,
  ActionTestResult,
  type ActionArgs,
  type ActionInput,
  type UpdateActionRequest,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useWorkspaceId } from '@/lib/use-workspace';

export function useActions(botId: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.actions(ws, botId),
    queryFn: async () => (await api(`/bots/${botId}/actions`, ActionListResponse)).data,
    enabled: Boolean(ws),
  });
}

export function useAction(botId: string, actionId: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...queryKeys.actions(ws, botId), actionId] as const,
    queryFn: () => api(`/bots/${botId}/actions/${actionId}`, ActionDto),
    enabled: Boolean(ws) && Boolean(actionId),
  });
}

function useRefreshActions(botId: string) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: queryKeys.actions(ws, botId) });
}

/** Create (no `id`) or update (PATCH) an action. */
export function useSaveAction(botId: string) {
  const refresh = useRefreshActions(botId);
  return useMutation({
    mutationFn: (input: { id?: string; body: ActionInput | UpdateActionRequest }) =>
      input.id
        ? api(`/bots/${botId}/actions/${input.id}`, ActionDto, {
            method: 'PATCH',
            body: input.body,
          })
        : api(`/bots/${botId}/actions`, ActionDto, { method: 'POST', body: input.body }),
    onSettled: refresh,
  });
}

export function useToggleAction(botId: string) {
  const refresh = useRefreshActions(botId);
  return useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      api(`/bots/${botId}/actions/${input.id}`, ActionDto, {
        method: 'PATCH',
        body: { enabled: input.enabled } satisfies UpdateActionRequest,
      }),
    onSettled: refresh,
  });
}

export function useDeleteAction(botId: string) {
  const refresh = useRefreshActions(botId);
  return useMutation({
    mutationFn: (actionId: string) =>
      api(`/bots/${botId}/actions/${actionId}`, z.null(), { method: 'DELETE' }),
    onSettled: refresh,
  });
}

/** Calls the API with the form as typed (saved or not); nothing is stored. */
export function useTestDraft(botId: string, actionId: string | undefined) {
  return useMutation({
    mutationFn: (input: { action: ActionInput; args: ActionArgs }) =>
      api(`/bots/${botId}/actions/test`, ActionTestResult, {
        method: 'POST',
        body: { ...input, ...(actionId && { actionId }) },
      }),
  });
}
