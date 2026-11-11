import type { TaskDto, TodayQueue as TodayQueueDto } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

import { useCompleteTask } from '../api/brain';
import { TodayItem, type ItemHandlers } from './today-item';

/** One queue of Today as a card: title, count, items or an empty line. */
export function TodayQueue({
  queue,
  handlers,
  now,
}: {
  queue: TodayQueueDto;
  handlers: ItemHandlers;
  now: number;
}) {
  const { t } = useTranslation('brain');
  const headingId = `today-queue-${queue.key}`;
  const empty = queue.items.length === 0;
  return (
    <section
      aria-labelledby={headingId}
      id={`queue-${queue.key}`}
      className="flex min-w-0 scroll-mt-20 flex-col overflow-hidden rounded-xl border bg-card"
    >
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <h2 id={headingId} className="min-w-0 truncate text-sm font-semibold">
          {t(`queues.${queue.key}.title`)}
        </h2>
        <span
          className={cn(
            'ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums',
            queue.count > 0 ? 'bg-primary-soft text-brand-text' : 'bg-muted text-muted-foreground',
          )}
        >
          <span aria-hidden>{queue.count}</span>
          <span className="sr-only">{t('today.countLabel', { count: queue.count })}</span>
        </span>
      </header>
      {empty ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{t(`queues.${queue.key}.empty`)}</p>
      ) : queue.key === 'tasks' ? (
        <ul className="divide-y">
          {queue.items.map((task) => (
            <TaskRow key={task.id} task={task} now={now} />
          ))}
        </ul>
      ) : (
        <ul className="divide-y">
          {queue.items.map((item) => (
            <TodayItem
              key={item.conversationId}
              item={item}
              handlers={handlers}
              queue={queue.key}
            />
          ))}
        </ul>
      )}
      {queue.count > queue.items.length ? (
        // No inbox filter matches a queue, so the rest is a count, not a link.
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          {t('today.more', { count: queue.count - queue.items.length })}
        </p>
      ) : null}
    </section>
  );
}

/** A due time in Asia/Ho_Chi_Minh, the zone the task dialog uses, in the UI language. */
function dueLabel(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(iso));
}

/** An open task: tick to complete, its due time (red when overdue) and assignee. */
export function TaskRow({ task, now }: { task: TaskDto; now: number }) {
  const { t, i18n } = useTranslation('brain');
  const complete = useCompleteTask({
    onDone: () => toast.success(t('task.completed')),
    onFailed: () => toast.error(t('task.error')),
  });
  const overdue = task.dueAt !== null && Date.parse(task.dueAt) < now;
  const checkboxId = `task-${task.id}`;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Checkbox
        id={checkboxId}
        className="mt-0.5"
        aria-label={t('task.complete', { title: task.title })}
        // Controlled: a failed completion unticks it again (the row stays).
        checked={complete.isPending || complete.isSuccess}
        disabled={complete.isPending || complete.isSuccess}
        onCheckedChange={(checked) => {
          if (checked === true) complete.mutate(task.id);
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor={checkboxId} className="text-sm font-medium break-words">
          {task.title}
        </label>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {task.dueAt ? (
            <span className={cn('tabular-nums', overdue && 'font-medium text-destructive')}>
              {overdue ? `${t('task.overdue')} · ` : ''}
              {t('task.dueAt', { time: dueLabel(task.dueAt, i18n.language) })}
            </span>
          ) : null}
          <span>{task.assigneeName ?? t('task.unassigned')}</span>
          {task.conversationId ? (
            <Link
              to="/app/inbox"
              search={{ conversation: task.conversationId }}
              className="text-brand-text hover:underline"
            >
              {t('item.open')}
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}
