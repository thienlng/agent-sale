import type { AssistantThreadDto } from '@agent-sales/contracts';
import { Archive, ArrowLeft, Search } from 'lucide-react';
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
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import {
  useAssistantThreads,
  useDeleteAssistantThread,
  useUpdateAssistantThread,
} from '../api/assistant';
import { type RowActions, ThreadRow } from './assistant-thread-row';

export type ThreadGroup = 'pinned' | 'today' | 'yesterday' | 'week' | 'month' | 'older';
const GROUP_ORDER: readonly ThreadGroup[] = [
  'pinned',
  'today',
  'yesterday',
  'week',
  'month',
  'older',
];
const DAY_MS = 86_400_000;

/** Midnight of the day `at` falls on, in the browser's time zone. */
function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * The threads by recency, the way chat apps list them: pinned first, then today, yesterday, the
 * previous 7 and 30 days, older. The server's order (pinned, then latest message) is kept inside
 * each group; empty groups are left out.
 */
export function groupThreads(
  threads: readonly AssistantThreadDto[],
  now = Date.now(),
): Array<{ group: ThreadGroup; threads: AssistantThreadDto[] }> {
  const today = startOfDay(now);
  const groups = new Map<ThreadGroup, AssistantThreadDto[]>();
  for (const thread of threads) {
    const at = Date.parse(thread.lastMessageAt);
    const group: ThreadGroup = thread.pinned
      ? 'pinned'
      : at >= today
        ? 'today'
        : at >= today - DAY_MS
          ? 'yesterday'
          : at >= today - 7 * DAY_MS
            ? 'week'
            : at >= today - 30 * DAY_MS
              ? 'month'
              : 'older';
    groups.set(group, [...(groups.get(group) ?? []), thread]);
  }
  return GROUP_ORDER.filter((g) => groups.has(g)).map((group) => ({
    group,
    threads: groups.get(group) ?? [],
  }));
}

type RemoveKind = 'archived' | 'deleted';

/**
 * The owner's conversations by recency, pinned first, searchable (300 ms debounce, `q`). Each row
 * has a "⋯" menu (rename inline, pin, archive, delete after a confirm); the link at the bottom
 * switches to the archived conversations (unarchive, delete). `onCurrentRemoved` runs when the
 * conversation on screen is archived or deleted, so the caller can open a fresh one.
 */
export function AssistantThreadList({
  currentId,
  onPick,
  onCurrentRemoved,
  className,
}: {
  currentId: string | null;
  onPick: (threadId: string) => void;
  onCurrentRemoved?: () => void;
  className?: string;
}) {
  const { t } = useTranslation('assistant');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [deleting, setDeleting] = useState<AssistantThreadDto | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);
  const threads = useAssistantThreads(q, { archived: showArchived });
  const update = useUpdateAssistantThread();
  const remove = useDeleteAssistantThread();

  const removed = (thread: AssistantThreadDto, kind: RemoveKind) => {
    toast.success(t(`threadMenu.${kind}`));
    if (thread.id === currentId) onCurrentRemoved?.();
  };
  const failed = (error: Error) =>
    toast.error(
      error instanceof ApiClientError && error.details?.reason === 'thread_running'
        ? t('threadMenu.running')
        : t('threadMenu.error'),
    );
  const actions: RowActions = {
    rename: (thread, title) => update.mutate({ threadId: thread.id, title }, { onError: failed }),
    pin: (thread) =>
      update.mutate({ threadId: thread.id, pinned: !thread.pinned }, { onError: failed }),
    archive: (thread) =>
      update.mutate(
        { threadId: thread.id, archived: true },
        { onSuccess: () => removed(thread, 'archived'), onError: failed },
      ),
    unarchive: (thread) =>
      update.mutate(
        { threadId: thread.id, archived: false },
        { onSuccess: () => toast.success(t('threadMenu.unarchived')), onError: failed },
      ),
    askDelete: setDeleting,
  };
  const confirmDelete = () => {
    const thread = deleting;
    setDeleting(null);
    if (!thread) return;
    remove.mutate(thread.id, { onSuccess: () => removed(thread, 'deleted'), onError: failed });
  };

  const rows = (items: AssistantThreadDto[]) => (
    <ul className="flex flex-col gap-px">
      {items.map((thread) => (
        <ThreadRow
          key={thread.id}
          thread={thread}
          current={thread.id === currentId}
          onPick={onPick}
          actions={actions}
        />
      ))}
    </ul>
  );

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="relative px-3 pb-2">
        <Search
          className="pointer-events-none absolute top-1/2 left-5.5 size-4 -translate-y-[calc(50%+4px)] text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          aria-label={t('search')}
          placeholder={t('search')}
          value={text}
          maxLength={200}
          className="h-9 pl-8"
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {threads.isPending ? (
          <div className="flex flex-col gap-2 px-2 pt-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : threads.isError ? (
          <p className="px-2 pt-2 text-sm text-destructive">{t('loadError')}</p>
        ) : threads.data.length === 0 ? (
          <p className="px-2 pt-2 text-sm text-muted-foreground">
            {q ? t('noResults') : showArchived ? t('threadMenu.noArchived') : t('noThreads')}
          </p>
        ) : showArchived ? (
          <section aria-label={t('threadMenu.showArchived')} className="pt-2">
            <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
              {t('threadMenu.showArchived')}
            </h3>
            {rows(threads.data)}
          </section>
        ) : (
          groupThreads(threads.data).map(({ group, threads: items }) => (
            <section key={group} aria-label={t(`threadGroups.${group}`)} className="pt-2">
              <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                {t(`threadGroups.${group}`)}
              </h3>
              {rows(items)}
            </section>
          ))
        )}
      </div>
      <div className="shrink-0 border-t px-2 py-2">
        <button
          type="button"
          aria-pressed={showArchived}
          onClick={() => setShowArchived((v) => !v)}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {showArchived ? (
            <ArrowLeft className="size-4 shrink-0" aria-hidden />
          ) : (
            <Archive className="size-4 shrink-0" aria-hidden />
          )}
          {showArchived ? t('threadMenu.hideArchived') : t('threadMenu.showArchived')}
        </button>
      </div>
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('threadMenu.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('threadMenu.deleteBody', {
                title: deleting ? deleting.title || t('untitled') : '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('threadMenu.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              {t('threadMenu.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
