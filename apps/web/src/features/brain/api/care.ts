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
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { api, ApiClientError } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

import { brainKeys, TODAY_REFETCH_MS } from './brain';

/**
 * The care agent on the web (spec 2026-11-11 care-agent-autonomy, ADR-031): the "Chờ duyệt"
 * drafts on Today, "AI đã làm", "Rapiz đã mang lại", and the care settings with the autonomy
 * level. Settings, levels and "AI đã làm" sit under `brainKeys.all`, so an action on Today
 * refreshes them; the impact (a 30-day aggregate) does not: it is read on its own schedule.
 */
export const careKeys = {
  settings: (ws: string) => [...brainKeys.all(ws), 'care-settings'] as const,
  autonomy: (ws: string) => [...brainKeys.all(ws), 'autonomy'] as const,
  impact: (ws: string, range: ImpactRange) => ['brain-impact', ws, range] as const,
  aiDone: (ws: string) => [...brainKeys.all(ws), 'ai-done'] as const,
};

/** The drafts still waiting, without the given ones (sent, dropped). */
export function withoutDrafts(today: TodayResponse, ids: readonly string[]): TodayResponse {
  return {
    ...today,
    queues: today.queues.map((q) => {
      if (q.key !== 'approval') return q;
      const items = q.items.filter((i) => !ids.includes(i.careMessageId));
      const gone = q.items.filter((i) => ids.includes(i.careMessageId) && !i.scheduledFor);
      return { ...q, items, count: Math.max(0, q.count - gone.length) };
    }),
  };
}

/**
 * Puts back only the given drafts (from `previous`) into the current Today, where they are
 * missing: a failed action never resurrects another draft that is still being sent.
 */
export function withDrafts(
  today: TodayResponse,
  previous: TodayResponse,
  ids: readonly string[],
): TodayResponse {
  const before = previous.queues.find((q) => q.key === 'approval');
  if (!before || before.key !== 'approval') return today;
  return {
    ...today,
    queues: today.queues.map((q) => {
      if (q.key !== 'approval') return q;
      const present = new Set(q.items.map((i) => i.careMessageId));
      const back = before.items.filter(
        (i) => ids.includes(i.careMessageId) && !present.has(i.careMessageId),
      );
      if (!back.length) return q;
      const order = new Map(before.items.map((i, n) => [i.careMessageId, n]));
      const items = [...q.items, ...back].sort(
        (x, y) => (order.get(x.careMessageId) ?? 1e9) - (order.get(y.careMessageId) ?? 1e9),
      );
      return { ...q, items, count: q.count + back.filter((i) => !i.scheduledFor).length };
    }),
  };
}

/** True when the draft can no longer be sent: its 24-hour window has closed. */
export function draftExpired(item: TodayApprovalItem, now: number): boolean {
  return item.windowClosesAt !== null && Date.parse(item.windowClosesAt) <= now;
}

/** "08:00" in the business's time zone (Asia/Ho_Chi_Minh), for "Sẽ gửi lúc 08:00". */
export function sendTime(at: string, language: string): string {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(at));
}

/** The module code of a refused approval (409 `details.reason`), when there is one. */
function refusal(e: unknown): string | null {
  if (!(e instanceof ApiClientError)) return null;
  const reason = e.details?.reason;
  return typeof reason === 'string' ? reason : null;
}

/** What a failed approval means for the member (by the server's code). */
function useApprovalErrorToast() {
  const { t } = useTranslation('brain');
  return (e: unknown) => {
    const code = refusal(e);
    const known: Record<string, string> = {
      CARE_TAKEN_OVER: 'approval.errors.takenOver',
      CARE_CUSTOMER_REPLIED: 'approval.errors.customerReplied',
      CARE_LIMIT_REACHED: 'approval.errors.limit',
      CARE_WINDOW_CLOSED: 'approval.errors.windowClosed',
      CARE_STOPPED: 'approval.errors.stopped',
    };
    const key = code ? known[code] : undefined;
    toast.error(
      key
        ? t(key)
        : e instanceof ApiClientError && (e.status === 409 || e.status === 404)
          ? t('approval.gone')
          : t('approval.failed'),
    );
  };
}

/**
 * Takes drafts off the cached Today at once; on failure puts back only the drafts of the failed
 * request. The toasts live here, not in the row: the row unmounts as soon as its draft leaves
 * the cache, and callbacks passed to `mutate()` of an unmounted observer never run.
 */
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
      return { previous, ids };
    },
    putBack: (
      context: { previous?: TodayResponse | undefined; ids: readonly string[] } | undefined,
      ids?: readonly string[],
    ) => {
      const previous = context?.previous;
      if (!previous) return;
      qc.setQueryData<TodayResponse>(brainKeys.today(ws), (current) =>
        current ? withDrafts(current, previous, ids ?? context.ids) : current,
      );
    },
    settle: () => qc.invalidateQueries({ queryKey: brainKeys.all(ws) }),
  };
}

/** "Gửi" (no text) and "Sửa rồi gửi" (the edited text); `name` is for the toast. */
export function useApproveDraft() {
  const o = useOptimisticDrafts();
  const { t, i18n } = useTranslation('brain');
  const onError = useApprovalErrorToast();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text?: string | undefined; name: string }) =>
      api(`/today/approval/${id}/approve`, CareMessageDto, {
        method: 'POST',
        body: text === undefined ? {} : { text },
        workspaceId: o.ws,
      }),
    onMutate: ({ id }) => o.remove([id]),
    onSuccess: (r, { name }) => {
      if (r.status === 'sent') toast.success(t('approval.sent', { name }));
      else if (r.status === 'scheduled' && r.scheduledFor)
        toast.success(
          t('approval.scheduled', { name, time: sendTime(r.scheduledFor, i18n.language) }),
        );
      else toast.warning(t('approval.notSent'));
    },
    onError: (e, _v, context) => {
      o.putBack(context);
      onError(e);
    },
    onSettled: o.settle,
  });
}

/** "Bỏ": the draft is dropped, nothing is sent. */
export function useRejectDraft() {
  const o = useOptimisticDrafts();
  const { t } = useTranslation('brain');
  const onError = useApprovalErrorToast();
  return useMutation({
    mutationFn: ({ id }: { id: string; name: string }) =>
      api(`/today/approval/${id}/reject`, CareMessageDto, {
        method: 'POST',
        body: {},
        workspaceId: o.ws,
      }),
    onMutate: ({ id }) => o.remove([id]),
    onSuccess: () => toast.success(t('approval.rejected')),
    onError: (e, _v, context) => {
      o.putBack(context);
      onError(e);
    },
    onSettled: o.settle,
  });
}

/**
 * "Gửi tất cả": the drafts on screen, as they are (at most 50 per call). The server sends the
 * first few and queues the rest; drafts it left waiting (e.g. the 24-hour limit) come back.
 */
export function useApproveAllDrafts() {
  const o = useOptimisticDrafts();
  const { t } = useTranslation('brain');
  const onError = useApprovalErrorToast();
  return useMutation({
    mutationFn: (ids: string[]) =>
      api('/today/approval/approve-all', BulkApproveCareMessagesResponse, {
        method: 'POST',
        body: { ids: ids.slice(0, 50) },
        workspaceId: o.ws,
      }),
    onMutate: (ids) => o.remove(ids),
    onSuccess: (r, _ids, context) => {
      const waiting = r.results.filter((x) => x.status === 'draft').map((x) => x.id);
      if (waiting.length) o.putBack(context, waiting);
      const expired = r.results.filter((x) => x.status === 'expired').length;
      const failed = r.results.filter((x) => x.status === 'failed').length;
      const parts = [
        r.sent > 0 ? t('approval.bulk.sent', { count: r.sent }) : null,
        r.scheduled > 0 ? t('approval.bulk.scheduled', { count: r.scheduled }) : null,
        expired > 0 ? t('approval.bulk.expired', { count: expired }) : null,
        failed > 0 ? t('approval.bulk.failed', { count: failed }) : null,
        waiting.length > 0 ? t('approval.bulk.waiting', { count: waiting.length }) : null,
      ].filter((x): x is string => x !== null);
      const message = parts.join(' · ') || t('approval.bulk.none');
      if (expired + failed + waiting.length > 0) toast.warning(message);
      else toast.success(message);
    },
    onError: (e, _v, context) => {
      o.putBack(context);
      onError(e);
    },
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
