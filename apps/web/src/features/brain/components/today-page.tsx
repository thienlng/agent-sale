import type { ImpactRange, TodayItem, TodayResponse } from '@agent-sales/contracts';
import { AlertTriangle, CircleCheck, Info, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/permissions';
import { useSession } from '@/lib/session';

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

/** A queue with nothing in it: listed on one muted line instead of an empty card. */
function isIdle(queue: TodayResponse['queues'][number]): boolean {
  return queue.count === 0 && queue.items.length === 0;
}

/** Section headings of the statistics page ("Việc hôm nay", "Báo cáo") share this style. */
export const SECTION_TITLE = 'text-lg font-semibold tracking-tight';

/**
 * The statistics page with Today on top (spec 2026-11-11 §5; one screen since 2026-11-12): the
 * page header (business, date, "Làm mới"), the cap and manual-mode banners, "Rapiz đã mang lại",
 * then "Việc hôm nay" — what needs doing today, queue by queue, with the actions on each customer.
 * Queues with nothing in them collapse into one muted line. `children` (the route passes the
 * figures section) follows. "Làm mới" evaluates the conversations with new customer messages
 * within the day's evaluations; when they run out a banner says the queues use the data already
 * there.
 */
export function TodayPage({
  bookings = false,
  service = false,
  impactRange,
  title,
  children,
}: {
  bookings?: boolean;
  /** An education or spa business: "Rapiz đã mang lại" shows only once there is something. */
  service?: boolean;
  /** The period of the figures below, which "Rapiz đã mang lại" follows. */
  impactRange?: ImpactRange | undefined;
  title?: string;
  children?: ReactNode;
} = {}) {
  const { t, i18n } = useTranslation('brain');
  const session = useSession();
  const business = session?.memberships.find((m) => m.workspaceId === session.workspaceId);
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
  const active = queues.filter((q) => !isIdle(q));
  // The cards beside "Chờ duyệt" (which spans the row on its own), two to a row on wide screens.
  const cards = active.filter((q) => q.key !== 'approval');
  const usage = data?.usage;
  const left = usage && usage.limit !== null ? Math.max(0, usage.limit - usage.used) : null;
  const capped = left === 0;
  const subtitle = [business?.workspaceName, todayLabel(i18n.language, new Date(now))]
    .filter(Boolean)
    .join(' · ');

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
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-3">
        {/* On a phone the title takes the row and "Làm mới" goes under it. */}
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {title ?? t('analytics.title', { ns: 'common' })}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground first-letter:uppercase">{subtitle}</p>
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

      {capped || data?.mode === 'manual' || canSeeImpact ? (
        <div className="flex flex-col gap-3">
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
          {canSeeImpact ? (
            <ImpactStrip bookings={bookings} range={impactRange} hideWhenEmpty={service} />
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="today-work-title" className="flex flex-col gap-4">
        <h2 id="today-work-title" className={SECTION_TITLE}>
          {t('today.section')}
        </h2>
        {data ? (
          active.length === 0 ? (
            <>
              <p className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
                <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
                {t('today.allClear')}
              </p>
              <AiDoneSection />
            </>
          ) : (
            <>
              <nav
                aria-label={t('today.summary')}
                className="-mx-1 flex gap-2 overflow-x-auto px-1"
              >
                {queues.map((q) => {
                  const chip = (
                    <>
                      {t(`queues.${q.key}.title`)}
                      <span className="tabular-nums">{q.count}</span>
                    </>
                  );
                  const shape =
                    'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap';
                  // Nothing to jump to: an empty queue has no card, so its chip is plain text.
                  return isIdle(q) ? (
                    <span
                      key={q.key}
                      className={`${shape} border-transparent font-normal text-muted-foreground`}
                    >
                      {chip}
                    </span>
                  ) : (
                    <a key={q.key} href={`#queue-${q.key}`} className={`${shape} hover:bg-muted`}>
                      {chip}
                    </a>
                  );
                })}
              </nav>
              <div className="grid gap-4 lg:grid-cols-2">
                {active[0]?.key === 'approval' ? (
                  <ApprovalQueue queue={active[0]} now={now} canAct={canAct} />
                ) : null}
                {/* What the AI already sent today, right under what waits for a person. */}
                <AiDoneSection />
                {cards.map((q, i) => (
                  <TodayQueue
                    key={q.key}
                    queue={q}
                    handlers={handlers}
                    now={now}
                    // An odd last card takes the whole row instead of leaving a hole beside it.
                    className={
                      i === cards.length - 1 && cards.length % 2 === 1 ? 'lg:col-span-2' : undefined
                    }
                  />
                ))}
              </div>
            </>
          )
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
      </section>

      {children}
      <TaskDialog subject={task} onOpenChange={(open) => !open && setTask(null)} />
    </section>
  );
}
