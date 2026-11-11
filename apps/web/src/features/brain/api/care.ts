import {
  AiDoneResponse,
  AutonomySettingsResponse,
  BulkApproveCareMessagesResponse,
  CareMessageDto,
  CareSettingsResponse,
  CareTemplateDto,
  ImpactResponse,
  type AutonomyAction,
  type AutonomyLevel,
  type CareTemplateKey,
  type ImpactRange,
  type TodayApprovalItem,
  type TodayResponse,
  type UpdateCareTemplateRequest,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

import { brainKeys, TODAY_REFETCH_MS } from './brain';

/**
 * The care agent on the web (spec 2026-11-11 care-agent-autonomy, ADR-031): the "Chờ duyệt"
 * drafts on Today, "AI đã làm", "Rapiz đã mang lại", and the care settings with the autonomy
 * level. Every key sits under `brainKeys.all`, so an action on Today refreshes them too.
 */
export const careKeys = {
  settings: (ws: string) => [...brainKeys.all(ws), 'care-settings'] as const,
  autonomy: (ws: string) => [...brainKeys.all(ws), 'autonomy'] as const,
  impact: (ws: string, range: ImpactRange) => [...brainKeys.all(ws), 'impact', range] as const,
  aiDone: (ws: string) => [...brainKeys.all(ws), 'ai-done'] as const,
};

/** The drafts still waiting, without the given ones (sent, dropped). */
export function withoutDrafts(today: TodayResponse, ids: readonly string[]): TodayResponse {
  return {
    ...today,
    queues: today.queues.map((q) => {
      if (q.key !== 'approval') return q;
      const items = q.items.filter((i) => !ids.includes(i.careMessageId));
      return { ...q, items, count: Math.max(0, q.count - (q.items.length - items.length)) };
    }),
  };
}

/** True when the draft can no longer be sent: its 24-hour window has closed. */
export function draftExpired(item: TodayApprovalItem, now: number): boolean {
  return item.windowClosesAt !== null && Date.parse(item.windowClosesAt) <= now;
}

/** Takes drafts off the cached Today at once; puts them back when the request fails. */
function useOptimisticDrafts() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return {
    ws,
    qc,
    remove: async (ids: readonly string[]) => {
      await qc.cancelQueries({ queryKey: brainKeys.today(ws) });
      const previous = qc.getQueryData<TodayResponse>(brainKeys.today(ws));
      if (previous) qc.setQueryData(brainKeys.today(ws), withoutDrafts(previous, ids));
      return { previous };
    },
    restore: (context: { previous?: TodayResponse | undefined } | undefined) => {
      if (context?.previous) qc.setQueryData(brainKeys.today(ws), context.previous);
    },
    settle: () => qc.invalidateQueries({ queryKey: brainKeys.all(ws) }),
  };
}

/** "Gửi" (no text) and "Sửa rồi gửi" (the edited text). */
export function useApproveDraft() {
  const o = useOptimisticDrafts();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text?: string | undefined }) =>
      api(`/today/approval/${id}/approve`, CareMessageDto, {
        method: 'POST',
        body: text === undefined ? {} : { text },
        workspaceId: o.ws,
      }),
    onMutate: ({ id }) => o.remove([id]),
    onError: (_e, _v, context) => o.restore(context),
    onSettled: o.settle,
  });
}

/** "Bỏ": the draft is dropped, nothing is sent. */
export function useRejectDraft() {
  const o = useOptimisticDrafts();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/today/approval/${id}/reject`, CareMessageDto, {
        method: 'POST',
        body: {},
        workspaceId: o.ws,
      }),
    onMutate: (id) => o.remove([id]),
    onError: (_e, _v, context) => o.restore(context),
    onSettled: o.settle,
  });
}

/** "Gửi tất cả": the drafts on screen, as they are (at most 50 per call). */
export function useApproveAllDrafts() {
  const o = useOptimisticDrafts();
  return useMutation({
    mutationFn: (ids: string[]) =>
      api('/today/approval/approve-all', BulkApproveCareMessagesResponse, {
        method: 'POST',
        body: { ids: ids.slice(0, 50) },
        workspaceId: o.ws,
      }),
    onMutate: (ids) => o.remove(ids),
    onError: (_e, _v, context) => o.restore(context),
    onSettled: o.settle,
  });
}

/** "AI đã làm": today's sends at level "làm rồi báo". */
export function useAiDone() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: careKeys.aiDone(ws),
    queryFn: ({ signal }) => api('/today/ai-done', AiDoneResponse, { workspaceId: ws, signal }),
    enabled: Boolean(ws),
    refetchInterval: TODAY_REFETCH_MS,
  });
}

/** "Rapiz đã mang lại": whole-business figures (`analytics.view` + `contacts.view_all`). */
export function useImpact(range: ImpactRange, { enabled = true }: { enabled?: boolean } = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: careKeys.impact(ws, range),
    queryFn: ({ signal }) =>
      api(`/brain/impact?range=${range}`, ImpactResponse, { workspaceId: ws, signal }),
    enabled: enabled && Boolean(ws),
    staleTime: 5 * 60_000,
  });
}

export function useCareSettings() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: careKeys.settings(ws),
    queryFn: ({ signal }) =>
      api('/care/settings', CareSettingsResponse, { workspaceId: ws, signal }),
    enabled: Boolean(ws),
  });
}

export function useAutonomy() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: careKeys.autonomy(ws),
    queryFn: ({ signal }) =>
      api('/brain/autonomy', AutonomySettingsResponse, { workspaceId: ws, signal }),
    enabled: Boolean(ws),
  });
}

export interface CareSettingsChange {
  /** Only the levels that changed. */
  levels: Array<{ action: AutonomyAction; level: AutonomyLevel }>;
  /** Only the templates that changed. */
  templates: Array<{ key: CareTemplateKey } & UpdateCareTemplateRequest>;
}

/** Saves the changed levels and templates (one request each), then re-reads both. */
export function useSaveCareSettings() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ levels, templates }: CareSettingsChange) => {
      if (levels.length > 0)
        await api('/brain/autonomy', AutonomySettingsResponse, {
          method: 'PUT',
          body: { actions: levels },
          workspaceId: ws,
        });
      for (const { key, ...body } of templates)
        await api(`/care/templates/${key}`, CareTemplateDto, {
          method: 'PUT',
          body,
          workspaceId: ws,
        });
    },
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: careKeys.settings(ws) }),
        qc.invalidateQueries({ queryKey: careKeys.autonomy(ws) }),
      ]),
  });
}
