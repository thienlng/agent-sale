import type { NotificationDto } from '@agent-sales/contracts';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { requestAssistantOpen } from '@/lib/assistant-context';
import { formatRelativeTime } from '@/lib/format';
import { safeAppPath } from '@/lib/safe-app-path';
import { cn } from '@/lib/utils';

import { useMarkAllRead, useMarkRead, useNotifications } from '../api/notifications';

/** A body this long (or with this many lines) is clamped to three lines with "Xem thêm". */
const LONG_BODY_CHARS = 160;
const LONG_BODY_LINES = 3;

function NotificationItem({
  item,
  onOpen,
}: {
  item: NotificationDto;
  onOpen: (item: NotificationDto) => void;
}) {
  const { t } = useTranslation('notification');
  const [expanded, setExpanded] = useState(false);
  const long = item.body.length > LONG_BODY_CHARS || item.body.split('\n').length > LONG_BODY_LINES;
  const unread = item.readAt === null;
  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="flex w-full min-w-0 items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
      >
        <span
          aria-hidden
          className={cn(
            'mt-1.5 size-2 shrink-0 rounded-full',
            unread ? 'bg-primary' : 'bg-transparent',
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn('text-sm break-words', unread && 'font-semibold')}>
            {item.title}
            {unread ? <span className="sr-only"> ({t('bell.unread')})</span> : null}
          </span>
          <span
            className={cn(
              'text-xs break-words whitespace-pre-line text-muted-foreground',
              !expanded && 'line-clamp-3',
            )}
          >
            {item.body}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(item.createdAt)}
          </span>
        </span>
      </button>
      {long ? (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-3 pb-2 pl-7 text-xs"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t('bell.less') : t('bell.more')}
        </Button>
      ) : null}
    </li>
  );
}

/** The bell popover (lazy): newest 20, "Xem thêm", "Đánh dấu tất cả đã đọc". */
export function NotificationList({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation('notification');
  const router = useRouter();
  const list = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const anyUnread = items.some((n) => n.readAt === null);

  /** Marks the item read, then follows its target: a safe dashboard path or the report thread. */
  function open(item: NotificationDto): void {
    if (item.readAt === null) markRead.mutate(item.id);
    const target = item.target;
    if (!target) return;
    if (target.kind === 'path') {
      const to = safeAppPath(target.path);
      if (!to) return;
      onDone();
      void router.navigate({ href: to });
    } else {
      onDone();
      requestAssistantOpen({ reportRunId: target.runId });
    }
  }

  return (
    <div className="flex max-h-[min(32rem,70vh)] min-w-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <p className="flex-1 font-medium">{t('bell.title')}</p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          disabled={!anyUnread || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          {t('bell.markAll')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.isPending ? (
          <div className="flex flex-col gap-2 p-3" aria-label={t('bell.loading')}>
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : list.isError ? (
          <div className="flex flex-col items-start gap-2 p-3 text-sm">
            <p className="text-destructive">{t('bell.error')}</p>
            <Button size="sm" variant="outline" onClick={() => void list.refetch()}>
              {t('bell.retry')}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t('bell.empty')}</p>
        ) : (
          <ul>
            {items.map((item) => (
              <NotificationItem key={item.id} item={item} onOpen={open} />
            ))}
          </ul>
        )}
        {list.hasNextPage ? (
          <div className="border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t('bell.loadMore')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
