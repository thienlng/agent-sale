import {
  AssistantMemoryDto,
  AssistantMessageList,
  AssistantProposalDto,
  AssistantProposalList,
  type AssistantMessageDto,
  AssistantRunDto,
  AssistantThreadDto,
  AssistantThreadList,
  type SendAssistantMessageRequest,
  SendAssistantMessageResponse,
  type UpdateAssistantThreadRequest,
} from '@agent-sales/contracts';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

export const assistantKeys = {
  all: (ws: string) => ['ws', ws, 'assistant'] as const,
  threads: (ws: string, q: string, archived = false) =>
    ['ws', ws, 'assistant', 'threads', archived ? 'archived' : 'open', q] as const,
  messages: (ws: string, threadId: string) =>
    ['ws', ws, 'assistant', 'messages', threadId] as const,
  run: (ws: string, runId: string) => ['ws', ws, 'assistant', 'runs', runId] as const,
  proposals: (ws: string, threadId: string) =>
    ['ws', ws, 'assistant', 'proposals', threadId] as const,
  memory: (ws: string) => ['ws', ws, 'assistant', 'memory'] as const,
  skills: (ws: string) => ['ws', ws, 'assistant', 'skills'] as const,
  skill: (ws: string, ref: string) => ['ws', ws, 'assistant', 'skills', 'one', ref] as const,
  skillEvents: (ws: string, skillId: string) =>
    ['ws', ws, 'assistant', 'skills', 'events', skillId] as const,
  learning: (ws: string) => ['ws', ws, 'assistant', 'learning'] as const,
  settings: (ws: string) => ['ws', ws, 'assistant', 'settings'] as const,
  suggestions: (ws: string) => ['ws', ws, 'assistant', 'suggestions'] as const,
  /** Mutation key of the approve/reject call of one proposal (its busy state outlives the card). */
  decision: (ws: string, proposalId: string) =>
    ['ws', ws, 'assistant', 'proposal-decision', proposalId] as const,
};

export type ProposalDecision = 'approve' | 'reject';

/** The owner's open (or, with `archived`, archived) threads, pinned first (search by `q`). */
export function useAssistantThreads(q: string, { archived = false } = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: assistantKeys.threads(ws, q, archived),
    queryFn: ({ signal }) => {
      const params = [
        ...(q ? [`q=${encodeURIComponent(q)}`] : []),
        ...(archived ? ['archived=true'] : []),
      ];
      return api(
        `/assistant/threads${params.length ? `?${params.join('&')}` : ''}`,
        AssistantThreadList,
        {
          workspaceId: ws,
          signal,
        },
      );
    },
    // The server orders pinned first already; keep it stable whatever the source.
    select: (list) => [...list.data].sort((a, b) => Number(b.pinned) - Number(a.pinned)),
    enabled: Boolean(ws),
  });
}

export function useAssistantMessages(threadId: string | null) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: assistantKeys.messages(ws, threadId ?? ''),
    queryFn: ({ signal }) =>
      api(`/assistant/threads/${threadId}/messages`, AssistantMessageList, {
        workspaceId: ws,
        signal,
      }).then((list) => list.data),
    enabled: Boolean(ws && threadId),
  });
}

/**
 * How long a live turn waits before its first poll. The send and the first poll leave together,
 * and the server creates the run row only when the send arrives: a poll at once answered 404 on
 * every turn (T-188). The run row is the first thing the send writes, well within this delay.
 */
export const FIRST_RUN_POLL_MS = 1000;

/**
 * One run with its steps. `poll` refetches every second while a turn runs. A live turn starts
 * polling only after `FIRST_RUN_POLL_MS`, once the send has created the run; should a poll still
 * miss it, errors are not retried and simply wait for the next poll.
 */
export function useAssistantRun(runId: string | null, { poll = false } = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: assistantKeys.run(ws, runId ?? ''),
    queryFn: ({ signal }) =>
      api(`/assistant/runs/${runId}`, AssistantRunDto, { workspaceId: ws, signal }),
    enabled: Boolean(ws && runId),
    retry: false,
    refetchInterval: poll ? 1000 : false,
  });
}

export function useCreateAssistantThread() {
  const ws = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api('/assistant/threads', AssistantThreadDto, {
        method: 'POST',
        body: {},
        workspaceId: ws,
      }),
    // A new thread has no messages: no fetch needed, and the first send stays optimistic.
    onSuccess: (thread) => {
      queryClient.setQueryData<AssistantMessageDto[]>(assistantKeys.messages(ws, thread.id), []);
    },
  });
}

/** Rename, pin/unpin or archive/unarchive one thread; every thread list is refetched. */
export function useUpdateAssistantThread() {
  const ws = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, ...patch }: UpdateAssistantThreadRequest & { threadId: string }) =>
      api(`/assistant/threads/${threadId}`, AssistantThreadDto, {
        method: 'PATCH',
        body: patch,
        workspaceId: ws,
      }),
    // The new title or pin shows at once; the refetch then moves it to its place.
    onSuccess: (thread) => {
      queryClient.setQueriesData<AssistantThreadList>(
        { queryKey: [...assistantKeys.all(ws), 'threads'] },
        (old) => old && { data: old.data.map((item) => (item.id === thread.id ? thread : item)) },
      );
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: [...assistantKeys.all(ws), 'threads'] }),
  });
}

/**
 * Delete one thread for good (204). A 409 `thread_running` means the assistant is still answering
 * in it. Its cached messages and proposals are dropped; the thread lists are refetched.
 */
export function useDeleteAssistantThread() {
  const ws = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) =>
      api(`/assistant/threads/${threadId}`, z.null(), { method: 'DELETE', workspaceId: ws }),
    onSuccess: (_res, threadId) => {
      queryClient.removeQueries({ queryKey: assistantKeys.messages(ws, threadId) });
      queryClient.removeQueries({ queryKey: assistantKeys.proposals(ws, threadId) });
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: [...assistantKeys.all(ws), 'threads'] }),
  });
}

/** Optimistic owner message, replaced by the server's rows when the turn answers. */
function pendingMessage(turnId: string, text: string): AssistantMessageDto {
  return {
    id: `pending-${turnId}`,
    seq: Number.MAX_SAFE_INTEGER,
    role: 'user',
    content: text,
    uiActions: [],
    runId: null,
    feedback: null,
    createdAt: new Date().toISOString(),
  };
}

export function useSendAssistantMessage() {
  const ws = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, ...body }: SendAssistantMessageRequest & { threadId: string }) =>
      api(`/assistant/threads/${threadId}/messages`, SendAssistantMessageResponse, {
        method: 'POST',
        body,
        workspaceId: ws,
      }),
    onMutate: async ({ threadId, turnId, text }) => {
      const key = assistantKeys.messages(ws, threadId);
      // A refetch landing now would drop the optimistic row.
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<AssistantMessageDto[]>(key, (old = []) => [
        ...old,
        pendingMessage(turnId, text),
      ]);
    },
    onSuccess: (res, { threadId, turnId }) => {
      const key = assistantKeys.messages(ws, threadId);
      queryClient.setQueryData<AssistantMessageDto[]>(key, (old = []) => {
        const fresh = new Set(res.messages.map((m) => m.id));
        return [
          ...old.filter((m) => m.id !== `pending-${turnId}` && !fresh.has(m.id)),
          ...res.messages,
        ];
      });
      queryClient.setQueryData(assistantKeys.run(ws, res.run.id), res.run);
    },
    onError: (_error, { threadId, turnId }) => {
      const key = assistantKeys.messages(ws, threadId);
      queryClient.setQueryData<AssistantMessageDto[]>(key, (old = []) =>
        old.filter((m) => m.id !== `pending-${turnId}`),
      );
      // The owner's message may have been stored before the model failed: show the truth.
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onSettled: (_res, _error, { threadId }) => {
      void queryClient.invalidateQueries({ queryKey: [...assistantKeys.all(ws), 'threads'] });
      // A turn may have prepared proposals (writes waiting for the owner).
      void queryClient.invalidateQueries({ queryKey: assistantKeys.proposals(ws, threadId) });
      // A turn may have previewed an import again: the cached drafts can be stale.
      void queryClient.invalidateQueries({ queryKey: [...assistantKeys.all(ws), 'imports'] });
    },
  });
}

/** The thread's proposals, oldest first: writes the assistant prepared for the owner to decide. */
export function useAssistantProposals(threadId: string | null) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: assistantKeys.proposals(ws, threadId ?? ''),
    queryFn: ({ signal }) =>
      api(`/assistant/threads/${threadId}/proposals`, AssistantProposalList, {
        workspaceId: ws,
        signal,
      }).then((list) => list.items),
    enabled: Boolean(ws && threadId),
  });
}

/**
 * Approve or reject one proposal. Either way the server appends an event message to the thread,
 * so the thread's messages and proposals are refetched, also after a 409 (already decided or
 * expired) so the card shows the truth. The mutation is keyed by the proposal id, so its busy
 * state (`useProposalDecisionInFlight`) survives the card unmounting while the owner switches
 * panel views. `onError` lives on the mutation, so it still runs after the card is gone.
 * An approval also refetches the proposal's business queries (`['ws', businessId]`, not the
 * assistant's own), so the page behind the panel shows the change.
 */
export function useDecideAssistantProposal(
  proposal: { id: string; threadId: string; businessId: string },
  onError?: (error: Error) => void,
) {
  const ws = useWorkspaceId();
  const queryClient = useQueryClient();
  const { id: proposalId, threadId, businessId } = proposal;
  return useMutation({
    mutationKey: assistantKeys.decision(ws, proposalId),
    mutationFn: (decision: ProposalDecision) =>
      api(`/assistant/proposals/${proposalId}/${decision}`, AssistantProposalDto, {
        method: 'POST',
        body: {},
        workspaceId: ws,
      }),
    onSuccess: (proposal, decision) => {
      queryClient.setQueryData<AssistantProposalDto[]>(
        assistantKeys.proposals(ws, threadId),
        (old) => old?.map((p) => (p.id === proposal.id ? proposal : p)),
      );
      // Every feature key starts with ['ws', businessId]: the dashboard behind the panel refreshes.
      // The assistant's own queries are left to onSettled, so they are not fetched twice.
      if (decision === 'approve') {
        void queryClient.invalidateQueries({
          queryKey: ['ws', businessId],
          predicate: (q) => q.queryKey[2] !== 'assistant',
        });
      }
    },
    ...(onError ? { onError } : {}),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.proposals(ws, threadId) });
      void queryClient.invalidateQueries({ queryKey: assistantKeys.messages(ws, threadId) });
    },
  });
}

/** The decision being sent for this proposal right now, from any card instance; null if none. */
export function useProposalDecisionInFlight(proposalId: string): ProposalDecision | null {
  const ws = useWorkspaceId();
  const pending = useMutationState({
    filters: { mutationKey: assistantKeys.decision(ws, proposalId), status: 'pending' },
    select: (m) => m.state.variables as ProposalDecision,
  });
  return pending[0] ?? null;
}

/** What the assistant remembers about the owner, their notes and each business. */
export function useAssistantMemory() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: assistantKeys.memory(ws),
    queryFn: ({ signal }) =>
      api('/assistant/memory', AssistantMemoryDto, { workspaceId: ws, signal }),
    enabled: Boolean(ws),
  });
}

/** Forget one entry; the server answers with the remaining memory. */
export function useForgetAssistantMemory() {
  const ws = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ store, entryId }: { store: string; entryId: string }) =>
      api(
        `/assistant/memory/${encodeURIComponent(store)}/entries/${encodeURIComponent(entryId)}`,
        AssistantMemoryDto,
        { method: 'DELETE', workspaceId: ws },
      ),
    onSuccess: (memory) => queryClient.setQueryData(assistantKeys.memory(ws), memory),
  });
}

/** Approve an entry waiting for approval, so the assistant uses it; answers with the memory. */
export function useApproveAssistantMemory() {
  const ws = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ store, entryId }: { store: string; entryId: string }) =>
      api(
        `/assistant/memory/${encodeURIComponent(store)}/entries/${encodeURIComponent(entryId)}/approve`,
        AssistantMemoryDto,
        { method: 'POST', body: {}, workspaceId: ws },
      ),
    onSuccess: (memory) => queryClient.setQueryData(assistantKeys.memory(ws), memory),
  });
}
