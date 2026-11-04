import type { ScheduleDraft, ScheduleDto } from '@agent-sales/contracts';
import { ChevronDown, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ApiClientError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useWorkspaceId } from '@/lib/use-workspace';
import { cn } from '@/lib/utils';

import {
  useDeleteSchedule,
  useScheduleAction,
  useScheduleRuns,
  useSchedules,
} from '../api/schedules';
import { useAccountBusinesses, useBusinessName } from '../hooks/use-businesses';
import { useAssistantUi } from '../stores/assistant-ui.store';
import { cadenceText } from '../utils/cadence-text';
import { defaultTemplate, ScheduleEditor } from './schedule-editor';

/** The last runs of one schedule, newest first. */
function ScheduleRuns({ scheduleId }: { scheduleId: string }) {
  const { t } = useTranslation('assistant');
  const runs = useScheduleRuns(scheduleId);
  if (runs.isPending) return <Skeleton className="h-8" />;
  if (runs.isError) return <p className="text-xs text-destructive">{t('schedules.loadError')}</p>;
  if (!runs.data.length)
    return <p className="text-xs text-muted-foreground">{t('schedules.noRuns')}</p>;
  return (
    <ul className="flex flex-col gap-1.5 text-xs">
      {runs.data.map((run) => (
        <li key={run.id} className="flex min-w-0 flex-col rounded-md bg-muted/50 px-2 py-1.5">
          <span className="flex flex-wrap gap-x-1.5">
            <span className="font-medium">{t(`schedules.runStatus.${run.status}`)}</span>
            <span className="text-muted-foreground">{formatDateTime(run.startedAt)}</span>
            {run.trigger === 'manual' ? (
              <span className="text-muted-foreground">· {t('schedules.manual')}</span>
            ) : null}
          </span>
          {run.title ? <span className="break-words">{run.title}</span> : null}
          {run.delivery.email ? (
            <span className="text-muted-foreground">
              {t(`schedules.delivery.${run.delivery.email}`)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ScheduleCard({ schedule, onEdit }: { schedule: ScheduleDto; onEdit: () => void }) {
  const { t } = useTranslation('assistant');
  const business = useBusinessName(schedule.businessId);
  const action = useScheduleAction();
  const remove = useDeleteSchedule();
  const [showRuns, setShowRuns] = useState(false);
  const active = schedule.status === 'active';
  const last = schedule.lastRun;

  function act(kind: 'pause' | 'resume' | 'run'): void {
    action.mutate(
      { id: schedule.id, action: kind },
      {
        onSuccess: () => {
          if (kind === 'run') toast.success(t('schedules.runRequested'));
        },
        onError: (error) => {
          const reason =
            error instanceof ApiClientError ? (error.details?.['reason'] as string) : undefined;
          toast.error(
            t(`schedules.errors.${reason ?? 'generic'}`, {
              defaultValue: t('schedules.errors.generic'),
            }),
          );
        },
      },
    );
  }

  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{schedule.name}</p>
          <p className="text-xs text-muted-foreground">
            {t(`schedules.templates.${schedule.template}`)}
            {schedule.mode === 'alert' ? ` · ${t('schedules.modes.alert')}` : ''}
            {business ? ` · ${business}` : ''}
          </p>
        </div>
        <Switch
          checked={active}
          disabled={action.isPending}
          aria-label={active ? t('schedules.pause') : t('schedules.resume')}
          onCheckedChange={(on) => act(on ? 'resume' : 'pause')}
        />
      </div>
      <p className="text-sm" data-testid="schedule-cadence">
        {cadenceText(schedule.cadence, t)}
      </p>
      {!active ? (
        <Badge variant="secondary" className="w-fit whitespace-normal">
          {t(`schedules.pausedReasons.${schedule.pausedReason ?? 'owner'}`)}
        </Badge>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">{t('schedules.nextRun')}</dt>
        <dd>{active && schedule.nextRunAt ? formatDateTime(schedule.nextRunAt) : '—'}</dd>
        <dt className="text-muted-foreground">{t('schedules.lastRun')}</dt>
        <dd className="min-w-0">
          {last ? (
            <>
              {t(`schedules.runStatus.${last.status}`)}
              {last.finishedAt ? ` · ${formatDateTime(last.finishedAt)}` : ''}
              {last.delivery.email ? ` · ${t(`schedules.delivery.${last.delivery.email}`)}` : ''}
            </>
          ) : (
            t('schedules.never')
          )}
        </dd>
      </dl>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={!active || action.isPending}
          onClick={() => act('run')}
        >
          <Play aria-hidden />
          {t('schedules.runNow')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <Pencil aria-hidden />
          {t('schedules.edit')}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost" className="text-destructive">
              <Trash2 aria-hidden />
              {t('schedules.remove')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('schedules.removeTitle', { name: schedule.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>{t('schedules.removeBody')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('schedules.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() =>
                  remove.mutate(schedule.id, {
                    onSuccess: () => toast.success(t('schedules.removed')),
                    onError: () => toast.error(t('schedules.errors.generic')),
                  })
                }
              >
                {t('schedules.removeConfirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          aria-expanded={showRuns}
          onClick={() => setShowRuns((v) => !v)}
        >
          {t('schedules.runs')}
          <ChevronDown
            className={cn('transition-transform', showRuns && 'rotate-180')}
            aria-hidden
          />
        </Button>
      </div>
      {showRuns ? <ScheduleRuns scheduleId={schedule.id} /> : null}
    </li>
  );
}

type Editing = { schedule: ScheduleDto } | { draft: Partial<ScheduleDraft> } | null;

/**
 * "Lịch báo cáo" (T-172): the owner's report and alert schedules, with their next and last runs,
 * a switch, Chạy ngay / Sửa / Xoá, and the editor. A draft from an accepted suggestion opens the
 * editor prefilled.
 */
export function AssistantSchedules() {
  const { t } = useTranslation('assistant');
  const list = useSchedules();
  const ws = useWorkspaceId();
  // An education or spa business tracks requests, not revenue: the hint suggests a requests report.
  const industry = useAccountBusinesses().find((b) => b.id === ws)?.industry;
  const emptyHint =
    defaultTemplate(industry) === 'new_requests' ? 'schedules.emptyRequests' : 'schedules.empty';
  const [editing, setEditing] = useState<Editing>(null);
  const pendingDraft = useAssistantUi((s) => s.scheduleDraft);
  // An accepted suggestion (now or while the view is open) opens the editor prefilled.
  useEffect(() => {
    if (!pendingDraft) return;
    const draft = useAssistantUi.getState().takeScheduleDraft();
    if (draft) setEditing({ draft });
  }, [pendingDraft]);

  if (editing) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <ScheduleEditor
          schedule={'schedule' in editing ? editing.schedule : undefined}
          draft={'draft' in editing ? editing.draft : undefined}
          emailAvailable={list.data?.emailAvailable ?? false}
          onDone={() => setEditing(null)}
        />
      </div>
    );
  }

  const full = list.data ? list.data.used >= list.data.limit : true;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium">{t('schedules.title')}</h3>
          {list.data ? (
            <p className="text-xs text-muted-foreground">
              {t('schedules.used', { used: list.data.used, limit: list.data.limit })}
            </p>
          ) : null}
        </div>
        <Button size="sm" disabled={full} onClick={() => setEditing({ draft: {} })}>
          <Plus aria-hidden />
          {t('schedules.add')}
        </Button>
      </div>
      {list.isPending ? (
        <div className="flex flex-col gap-2" aria-label={t('schedules.loading')}>
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : list.isError ? (
        <p className="text-sm text-destructive">{t('schedules.loadError')}</p>
      ) : list.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(emptyHint)}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.data.items.map((s) => (
            <ScheduleCard key={s.id} schedule={s} onEdit={() => setEditing({ schedule: s })} />
          ))}
        </ul>
      )}
    </div>
  );
}
