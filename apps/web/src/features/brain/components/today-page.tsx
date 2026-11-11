import type { TodayItem, TodayResponse } from '@agent-sales/contracts';
import { AlertTriangle, Info, Loader2, RefreshCw } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';

import { useRefreshToday, useToday } from '../api/brain';
import { draftExpired } from '../api/care';
import { useItemActions } from '../hooks/use-item-actions';
import { AiDoneSection } from './ai-done-section';
import { ApprovalQueue } from './approval-queue';
import { ImpactStrip } from './impact-strip';
import { TaskDialog, type TaskSubject } from './task-dialog';
import { TodayQueue } from './today-queue';

/** "Thứ Tư, 11 tháng 11" in the UI language. */
function todayLabel(locale: string, now: Date): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(now);
}

/** The time, re-read every 30 seconds: drafts leave when their window closes. */
function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/**
 * The queues as shown: "Chờ duyệt" first (a person's decision is waiting, and the window runs
 * out), the other queues in the server's order, and no draft whose window already closed.
 */
export function visibleQueues(today: TodayResponse, now: number): TodayResponse['queues'] {
  const queues = today.queues.map((q) => {
    if (q.key !== 'approval') return q;
    const items = q.items.filter((i) => !draftExpired(i, now));
    return { ...q, items, count: Math.max(0, q.count - (q.items.length - items.length)) };
  });
  return [
    ...queues.filter((q) => q.key === 'approval'),
    ...queues.filter((q) => q.key !== 'approval'),
  ];
}

/**
 * Hôm nay (spec 2026-11-11 §5): what needs doing today, queue by queue, with the actions on each
 * customer. "Làm mới" evaluates the conversations with new customer messages within the day's
 * evaluations; when they run out a banner says the queues use the data already there.
 */
export function TodayPage() {
  const { t, i18n } = useTranslation('brain');
  const today = useToday();
  const refresh = useRefreshToday();
  const actions = useItemActions();
  const canAct = useCan('contacts.edit');
  // "Rapiz đã mang lại" covers the whole business (`GET /brain/impact`).
  const canViewAnalytics = useCan('analytics.view');
  const canViewAll = useCan('contacts.view_all');
  const canSeeImpact = canViewAnalytics && canViewAll;
  const [task, setTask] = useState<TaskSubject | null>(null);
  const now = useNow();
  const data = today.data;
  const queues = useMemo(() => (data ? visibleQueues(data, now) : []), [data, now]);
  const usage = data?.usage;
  const left = usage && usage.limit !== null ? Math.max(0, usage.limit - usage.used) : null;
  const capped = left === 0;

  const handlers = {
    onDraft: actions.draftReply,
    onEvaluate: actions.evaluate,
    onDismiss: actions.dismiss,
    onAddTask: (item: TodayItem) =>
      setTask({
        conversationId: item.conversationId,
        contactId: item.contactId,
        customerName: item.customerName,
      }),
    drafting: actions.drafting,
    evaluating: actions.evaluating,
    canAct,
  };

  function runRefresh() {
    refresh.mutate(undefined, {
      onSuccess: (r) => {
        // Ended by the time budget: say how many are left for the next click.
        if (r.partial)
          toast.info(t('today.partial', { count: r.evaluated, remaining: r.remaining }));
        else if (r.evaluated > 0) toast.success(t('today.refreshed', { count: r.evaluated }));
        else if (!r.capped) toast.info(t('today.refreshedNone'));
      },
      onError: () => toast.error(t('evaluate.failed')),
    });
  }

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('today.title')}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground first-letter:uppercase">
            {todayLabel(i18n.language, new Date(now))}
          </p>
        </div>
        {canAct ? (
          <Button
            variant="outline"
            onClick={runRefresh}
            disabled={refresh.isPending || capped || !data}
            className="shrink-0"
          >
            {refresh.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <RefreshCw aria-hidden />
            )}
            {refresh.isPending
              ? t('today.refreshing')
              : left === null
                ? t('today.refreshUnlimited')
                : t('today.refresh', { count: left })}
          </Button>
        ) : null}
      </header>

      {capped ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('today.capBanner')}
        </p>
      ) : null}
      {data?.mode === 'manual' ? (
        <p className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('today.manualHint')}
        </p>
      ) : null}

      {canSeeImpact ? <ImpactStrip /> : null}

      {data ? (
        <>
          <nav aria-label={t('today.summary')} className="-mx-1 flex gap-2 overflow-x-auto px-1">
            {queues.map((q) => (
              <a
                key={q.key}
                href={`#queue-${q.key}`}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap hover:bg-muted',
                  q.count === 0 && 'text-muted-foreground',
                )}
              >
                {t(`queues.${q.key}.title`)}
                <span className="tabular-nums">{q.count}</span>
              </a>
            ))}
          </nav>
          <div className="grid gap-4 lg:grid-cols-2">
            {queues.map((q) =>
              q.key === 'approval' ? (
                <Fragment key={q.key}>
                  <ApprovalQueue queue={q} now={now} canAct={canAct} />
                  {/* What the AI already sent today, right under what waits for a person. */}
                  <AiDoneSection />
                </Fragment>
              ) : (
                <TodayQueue key={q.key} queue={q} handlers={handlers} now={now} />
              ),
            )}
          </div>
        </>
      ) : today.isError ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border p-6">
          <p className="text-sm text-muted-foreground">{t('today.loadError')}</p>
          <Button variant="outline" size="sm" onClick={() => void today.refetch()}>
            {t('today.retry')}
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2" aria-busy>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      )}
      <TaskDialog subject={task} onOpenChange={(open) => !open && setTask(null)} />
    </section>
  );
}
