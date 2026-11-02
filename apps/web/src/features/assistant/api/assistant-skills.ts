import {
  AssistantLearningFeed,
  AssistantMemoryDto,
  AssistantSkillDto,
  AssistantSkillEventList,
  AssistantSkillList,
  type UpdateAssistantSkillRequest,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

import { assistantKeys } from './assistant';

/** The owner's skills: platform skills first, then their own rows in every state. */
export function useAssistantSkills() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: assistantKeys.skills(ws),
    queryFn: ({ signal }) =>
      api('/assistant/skills', AssistantSkillList, { workspaceId: ws, signal }).then(
        (list) => list.items,
      ),
    enabled: Boolean(ws),
  });
}

/** One skill with its body; `ref` is a row id or `platform:<name>`. */
export function useAssistantSkill(ref: string | null) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: assistantKeys.skill(ws, ref ?? ''),
    queryFn: ({ signal }) =>
      api(`/assistant/skills/${encodeURIComponent(ref ?? '')}`, AssistantSkillDto, {
        workspaceId: ws,
        signal,
      }),
    enabled: Boolean(ws && ref),
  });
}

/** A skill's change ledger, newest first (platform skills have none). */
export function useAssistantSkillEvents(skillId: string | null) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: assistantKeys.skillEvents(ws, skillId ?? ''),
    queryFn: ({ signal }) =>
      api(`/assistant/skills/${skillId}/events`, AssistantSkillEventList, {
        workspaceId: ws,
        signal,
      }).then((list) => list.items),
    enabled: Boolean(ws && skillId),
  });
}

/** After any skill change: the list, the open skill, its ledger and the learning notices. */
function useRefreshSkills() {
  const ws = useWorkspaceId();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: assistantKeys.skills(ws) });
    void queryClient.invalidateQueries({ queryKey: assistantKeys.learning(ws) });
  };
}

export type SkillAction = 'approve' | 'reject' | 'archive' | 'restore';

/** Approve or reject a pending learned skill, archive or restore a skill. */
export function useSkillAction() {
  const ws = useWorkspaceId();
  const refresh = useRefreshSkills();
  return useMutation({
    mutationFn: ({ skillId, action }: { skillId: string; action: SkillAction }) =>
      api(`/assistant/skills/${skillId}/${action}`, AssistantSkillDto, {
        method: 'POST',
        body: {},
        workspaceId: ws,
      }),
    onSettled: refresh,
  });
}

export function useUpdateSkill() {
  const ws = useWorkspaceId();
  const refresh = useRefreshSkills();
  return useMutation({
    mutationFn: ({ skillId, ...body }: UpdateAssistantSkillRequest & { skillId: string }) =>
      api(`/assistant/skills/${skillId}`, AssistantSkillDto, {
        method: 'PATCH',
        body,
        workspaceId: ws,
      }),
    onSettled: refresh,
  });
}

/** "Tinh chỉnh": an owner copy of a platform skill that replaces it. */
export function useShadowSkill() {
  const ws = useWorkspaceId();
  const refresh = useRefreshSkills();
  return useMutation({
    mutationFn: (name: string) =>
      api(`/assistant/skills/platform/${encodeURIComponent(name)}/shadow`, AssistantSkillDto, {
        method: 'POST',
        body: {},
        workspaceId: ws,
      }),
    onSettled: refresh,
  });
}

/** "Khôi phục bản gốc": drop the shadow, so the platform skill is used again. */
export function useDeleteShadow() {
  const ws = useWorkspaceId();
  const refresh = useRefreshSkills();
  return useMutation({
    mutationFn: (skillId: string) =>
      api(`/assistant/skills/${skillId}`, z.null(), { method: 'DELETE', workspaceId: ws }),
    onSettled: refresh,
  });
}

/** Undo one ledger entry; the server answers with the restored skill. */
export function useUndoSkillEvent() {
  const ws = useWorkspaceId();
  const refresh = useRefreshSkills();
  return useMutation({
    mutationFn: (eventId: string) =>
      api(`/assistant/skill-events/${eventId}/undo`, AssistantSkillDto, {
        method: 'POST',
        body: {},
        workspaceId: ws,
      }),
    onSettled: refresh,
  });
}

/** What the background review and the curator changed lately (ruling 1c-R2). */
export function useAssistantLearning() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: assistantKeys.learning(ws),
    queryFn: ({ signal }) =>
      api('/assistant/learning', AssistantLearningFeed, { workspaceId: ws, signal }).then(
        (feed) => feed.items,
      ),
    enabled: Boolean(ws),
  });
}

/** Undo a memory entry the review saved: forget it. */
export function useUndoLearnedMemory() {
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
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.learning(ws) });
    },
  });
}
