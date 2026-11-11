import type { TaskDto, TodayQueue as TodayQueueDto } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Checkbox } from '@/components/ui/checkbox';
import { formatDateTime } from '@/lib/format';
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
          aria-label={t('today.countLabel', { count: queue.count })}
        >
          {queue.count}
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
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          {queue.key === 'tasks' ? (
            t('today.more', { count: queue.count - queue.items.length })
          ) : (
            <Link to="/app/inbox" className="hover:underline">
              {t('today.more', { count: queue.count - queue.items.length })}
            </Link>
          )}
        </p>
      ) : null}
    </section>
  );
}

/** An open task: tick to complete, its due time (red when overdue) and assignee. */
export function TaskRow({ task, now }: { task: TaskDto; now: number }) {
  const { t } = useTranslation('brain');
  const complete = useCompleteTask();
  const overdue = task.dueAt !== null && Date.parse(task.dueAt) < now;
  const checkboxId = `task-${task.id}`;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Checkbox
        id={checkboxId}
        className="mt-0.5"
        aria-label={t('task.complete', { title: task.title })}
        disabled={complete.isPending}
        onCheckedChange={(checked) => {
          if (checked === true)
            complete.mutate(task.id, {
              onSuccess: () => toast.success(t('task.completed')),
              onError: () => toast.error(t('task.error')),
            });
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
              {t('task.dueAt', { time: formatDateTime(task.dueAt) })}
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
