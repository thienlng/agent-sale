import {
  type ScheduleDraft,
  ScheduleDto,
  ScheduleList,
  type SchedulePatch,
  SchedulePreview,
  ScheduleRunList,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

import { assistantKeys } from './assistant';

/** Schedules belong to the owner in the account; the keys sit under the assistant's. */
export const scheduleKeys = {
  all: (ws: string) => [...assistantKeys.all(ws), 'schedules'] as const,
  list: (ws: string) => [...assistantKeys.all(ws), 'schedules', 'list'] as const,
  runs: (ws: string, id: string) => [...assistantKeys.all(ws), 'schedules', 'runs', id] as const,
};

/** The owner's schedules, the limit, how many places are used and whether email can be sent. */
export function useSchedules() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: scheduleKeys.list(ws),
    queryFn: ({ signal }) => api('/assistant/schedules', ScheduleList, { workspaceId: ws, signal }),
    enabled: Boolean(ws),
  });
}

export function useScheduleRuns(scheduleId: string | null) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: scheduleKeys.runs(ws, scheduleId ?? ''),
    queryFn: ({ signal }) =>
      api(`/assistant/schedules/${scheduleId}/runs?limit=10`, ScheduleRunList, {
        workspaceId: ws,
        signal,
      }).then((r) => r.items),
    enabled: Boolean(ws && scheduleId),
  });
}

function useScheduleMutation<V>(call: (ws: string, vars: V) => Promise<unknown>) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) => call(ws, vars),
    onSettled: () => qc.invalidateQueries({ queryKey: scheduleKeys.all(ws) }),
  });
}

export function useCreateSchedule() {
  return useScheduleMutation((ws, draft: ScheduleDraft) =>
    api('/assistant/schedules', ScheduleDto, { method: 'POST', body: draft, workspaceId: ws }),
  );
}

export function useUpdateSchedule() {
  return useScheduleMutation((ws, { id, patch }: { id: string; patch: SchedulePatch }) =>
    api(`/assistant/schedules/${id}`, ScheduleDto, {
      method: 'PATCH',
      body: patch,
      workspaceId: ws,
    }),
  );
}

export type ScheduleAction = 'pause' | 'resume' | 'run';

/** Pause, resume or "Chạy ngay". */
export function useScheduleAction() {
  return useScheduleMutation((ws, { id, action }: { id: string; action: ScheduleAction }) =>
    api(`/assistant/schedules/${id}/${action}`, ScheduleDto, {
      method: 'POST',
      body: {},
      workspaceId: ws,
    }),
  );
}

export function useDeleteSchedule() {
  return useScheduleMutation((ws, id: string) =>
    api(`/assistant/schedules/${id}`, z.null(), { method: 'DELETE', workspaceId: ws }),
  );
}

/** "Xem thử": the draft's report computed now (no delivery). */
export function usePreviewSchedule() {
  const ws = useWorkspaceId();
  return useMutation({
    mutationFn: (draft: ScheduleDraft) =>
      api('/assistant/schedules/preview', SchedulePreview, {
        method: 'POST',
        body: draft,
        workspaceId: ws,
      }),
  });
}
