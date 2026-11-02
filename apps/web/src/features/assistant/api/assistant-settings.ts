import {
  AcceptAssistantSuggestionResponse,
  type AssistantMessageDto,
  AssistantSettingsDto,
  AssistantSuggestionDto,
  AssistantSuggestionList,
  type UpdateAssistantSettingsRequest,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

import { assistantKeys } from './assistant';

/** Review on/off and the toolsets with their use over 30 days. */
export function useAssistantSettings() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: assistantKeys.settings(ws),
    queryFn: ({ signal }) =>
      api('/assistant/settings', AssistantSettingsDto, { workspaceId: ws, signal }),
    enabled: Boolean(ws),
  });
}

export function useUpdateAssistantSettings() {
  const ws = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateAssistantSettingsRequest) =>
      api('/assistant/settings', AssistantSettingsDto, {
        method: 'PATCH',
        body,
        workspaceId: ws,
      }),
    onSuccess: (settings) => queryClient.setQueryData(assistantKeys.settings(ws), settings),
  });
}

/** Pending suggestion cards, newest first. */
export function useAssistantSuggestions() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: assistantKeys.suggestions(ws),
    queryFn: ({ signal }) =>
      api('/assistant/suggestions', AssistantSuggestionList, { workspaceId: ws, signal }).then(
        (list) => list.items,
      ),
    enabled: Boolean(ws),
  });
}

/** Accept or dismiss a card. An accepted skill card creates an owner skill. */
export function useDecideSuggestion() {
  const ws = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'accept' | 'dismiss' }) =>
      decision === 'accept'
        ? api(`/assistant/suggestions/${id}/accept`, AcceptAssistantSuggestionResponse, {
            method: 'POST',
            body: {},
            workspaceId: ws,
          })
        : api(`/assistant/suggestions/${id}/dismiss`, AssistantSuggestionDto, {
            method: 'POST',
            body: {},
            workspaceId: ws,
          }).then((suggestion) => ({ suggestion, skill: null, path: null })),
    onSuccess: (res) => {
      if (res.skill) void queryClient.invalidateQueries({ queryKey: assistantKeys.skills(ws) });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.suggestions(ws) });
    },
  });
}

export type FeedbackValue = 1 | -1 | 0;

/** Set every cached copy of one message's feedback (the thread's messages, wherever cached). */
function patchFeedback(
  queryClient: ReturnType<typeof useQueryClient>,
  ws: string,
  messageId: string,
  feedback: AssistantMessageDto['feedback'],
): void {
  queryClient.setQueriesData<AssistantMessageDto[]>(
    { queryKey: [...assistantKeys.all(ws), 'messages'] },
    (old) => old?.map((m) => (m.id === messageId ? { ...m, feedback } : m)),
  );
}

/** 👍/👎 on an answer, applied at once; a failure puts the server's value back. */
export function useMessageFeedback() {
  const ws = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, value }: { messageId: string; value: FeedbackValue }) =>
      api(`/assistant/messages/${messageId}/feedback`, z.null(), {
        method: 'POST',
        body: { value },
        workspaceId: ws,
      }),
    onMutate: ({ messageId, value }) =>
      patchFeedback(queryClient, ws, messageId, value === 0 ? null : value),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: [...assistantKeys.all(ws), 'messages'] });
    },
  });
}
