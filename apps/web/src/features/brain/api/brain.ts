import {
  BrainSettingsDto,
  BrainUsageDto,
  ConversationSignalResponse,
  CrmAssigneeList,
  EvaluateSignalsResponse,
  RefreshTodayResponse,
  ReplyDraftResponse,
  type SignalStage,
  TaskDto,
  TaskList,
  TodayResponse,
  type CreateTaskRequest,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useWorkspaceId } from '@/lib/use-workspace';

export const brainKeys = {
  all: (ws: string) => ['ws', ws, 'brain'] as const,
  today: (ws: string) => ['ws', ws, 'brain', 'today'] as const,
  settings: (ws: string) => ['ws', ws, 'brain', 'settings'] as const,
  usage: (ws: string) => ['ws', ws, 'brain', 'usage'] as const,
  signal: (ws: string, id: string) => ['ws', ws, 'brain', 'signal', id] as const,
  tasks: (ws: string, conversationId: string) =>
    ['ws', ws, 'brain', 'tasks', conversationId] as const,
};

/** The sidebar badge and the page share one read, refreshed every minute. */
export const TODAY_REFETCH_MS = 60_000;

export function useToday({ enabled = true }: { enabled?: boolean } = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: brainKeys.today(ws),
    queryFn: ({ signal }) => api('/today', TodayResponse, { workspaceId: ws, signal }),
    enabled: enabled && Boolean(ws),
    refetchInterval: TODAY_REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}

/** Items waiting on Today, for the sidebar badge. */
export function todayTotal(today: TodayResponse | undefined): number {
  return today?.queues.reduce((n, q) => n + q.count, 0) ?? 0;
}

export function useRefreshToday() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api('/today/refresh', RefreshTodayResponse, { method: 'POST', body: {}, workspaceId: ws }),
    onSuccess: (r) => {
      const { evaluated: _e, capped: _c, ...today } = r;
      qc.setQueryData(brainKeys.today(ws), today);
      void qc.invalidateQueries({ queryKey: brainKeys.usage(ws) });
    },
  });
}

/** Removes a conversation from every queue of a cached Today (dismissed, or acted on). */
function withoutConversation(today: TodayResponse, conversationId: string): TodayResponse {
  return {
    ...today,
    queues: today.queues.map((q) => {
      if (q.key === 'tasks') return q;
      const items = q.items.filter((i) => i.conversationId !== conversationId);
      return { ...q, items, count: Math.max(0, q.count - (q.items.length - items.length)) };
    }),
  };
}

export function useDismissTodayItem() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      api(`/today/items/${conversationId}/dismiss`, z.null(), {
        method: 'POST',
        body: {},
        workspaceId: ws,
      }),
    onMutate: async (conversationId) => {
      await qc.cancelQueries({ queryKey: brainKeys.today(ws) });
      const previous = qc.getQueryData<TodayResponse>(brainKeys.today(ws));
      if (previous)
        qc.setQueryData(brainKeys.today(ws), withoutConversation(previous, conversationId));
      return { previous };
    },
    onError: (_e, _id, context) => {
      if (context?.previous) qc.setQueryData(brainKeys.today(ws), context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: brainKeys.today(ws) }),
  });
}

export function useReplyDraft() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      api(`/conversations/${conversationId}/reply-draft`, ReplyDraftResponse, {
        method: 'POST',
        body: {},
        workspaceId: ws,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: brainKeys.usage(ws) }),
  });
}

export function useSignal(conversationId: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: brainKeys.signal(ws, conversationId),
    queryFn: ({ signal }) =>
      api(`/conversations/${conversationId}/signals`, ConversationSignalResponse, {
        workspaceId: ws,
        signal,
      }).then((r) => r.signal),
    enabled: Boolean(ws && conversationId),
  });
}

export function useEvaluateConversation() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      api(`/conversations/${conversationId}/signals/evaluate`, EvaluateSignalsResponse, {
        method: 'POST',
        body: {},
        workspaceId: ws,
      }),
    onSuccess: (r, conversationId) => {
      if (r.signal) qc.setQueryData(brainKeys.signal(ws, conversationId), r.signal);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: brainKeys.all(ws) }),
  });
}

/** A stage set by hand is locked; `null` unlocks it (the AI decides again). */
export function useSetStage() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      stage,
    }: {
      conversationId: string;
      stage: SignalStage | null;
    }) =>
      api(`/conversations/${conversationId}/signals`, ConversationSignalResponse, {
        method: 'PATCH',
        body: stage === null ? { stageLocked: false } : { stage },
        workspaceId: ws,
      }),
    onSuccess: (r, { conversationId }) =>
      qc.setQueryData(brainKeys.signal(ws, conversationId), r.signal),
    onSettled: () => qc.invalidateQueries({ queryKey: brainKeys.today(ws) }),
  });
}

/** Open tasks of one conversation (the inbox panel); everyone's with `contacts.view_all`. */
export function useConversationTasks(conversationId: string, scope: 'mine' | 'all') {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...brainKeys.tasks(ws, conversationId), scope],
    queryFn: ({ signal }) => {
      const q = new URLSearchParams({ conversationId, scope, status: 'open' });
      return api(`/tasks?${q.toString()}`, TaskList, { workspaceId: ws, signal }).then(
        (r) => r.data,
      );
    },
    enabled: Boolean(ws && conversationId),
  });
}

export function useCreateTask() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTaskRequest) =>
      api('/tasks', TaskDto, { method: 'POST', body, workspaceId: ws }),
    onSettled: () => qc.invalidateQueries({ queryKey: brainKeys.all(ws) }),
  });
}

export function useCompleteTask() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      api(`/tasks/${taskId}/complete`, TaskDto, { method: 'POST', body: {}, workspaceId: ws }),
    onMutate: async (taskId) => {
      await qc.cancelQueries({ queryKey: brainKeys.today(ws) });
      const previous = qc.getQueryData<TodayResponse>(brainKeys.today(ws));
      if (previous)
        qc.setQueryData<TodayResponse>(brainKeys.today(ws), {
          ...previous,
          queues: previous.queues.map((q) =>
            q.key === 'tasks'
              ? {
                  ...q,
                  items: q.items.filter((t) => t.id !== taskId),
                  count: Math.max(0, q.count - (q.items.some((t) => t.id === taskId) ? 1 : 0)),
                }
              : q,
          ),
        });
      return { previous };
    },
    onError: (_e, _id, context) => {
      if (context?.previous) qc.setQueryData(brainKeys.today(ws), context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: brainKeys.all(ws) }),
  });
}

/** Members a task can be given to (any member may read the list). */
export function useTaskAssignees({ enabled = true }: { enabled?: boolean } = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.crmAssignees(ws),
    queryFn: async () => (await api('/crm/assignees', CrmAssigneeList)).data,
    enabled: enabled && Boolean(ws),
    staleTime: 60_000,
  });
}

export function useBrainSettings() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: brainKeys.settings(ws),
    queryFn: ({ signal }) => api('/brain/settings', BrainSettingsDto, { workspaceId: ws, signal }),
    enabled: Boolean(ws),
  });
}

export function useBrainUsage() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: brainKeys.usage(ws),
    queryFn: ({ signal }) => api('/brain/usage', BrainUsageDto, { workspaceId: ws, signal }),
    enabled: Boolean(ws),
  });
}

export function useSaveBrainSettings() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BrainSettingsDto) =>
      api('/brain/settings', BrainSettingsDto, { method: 'PUT', body, workspaceId: ws }),
    onSuccess: (saved) => qc.setQueryData(brainKeys.settings(ws), saved),
    onSettled: () => qc.invalidateQueries({ queryKey: brainKeys.today(ws) }),
  });
}
