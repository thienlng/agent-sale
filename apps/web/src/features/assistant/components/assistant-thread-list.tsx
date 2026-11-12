import type { AssistantThreadDto } from '@agent-sales/contracts';
import { Pin, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { useAssistantThreads } from '../api/assistant';

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

/** The owner's conversations by recency, pinned first, searchable (300 ms debounce, `q`). */
export function AssistantThreadList({
  currentId,
  onPick,
  className,
}: {
  currentId: string | null;
  onPick: (threadId: string) => void;
  className?: string;
}) {
  const { t } = useTranslation('assistant');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);
  const threads = useAssistantThreads(q);

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
            {q ? t('noResults') : t('noThreads')}
          </p>
        ) : (
          groupThreads(threads.data).map(({ group, threads: items }) => (
            <section key={group} aria-label={t(`threadGroups.${group}`)} className="pt-2">
              <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                {t(`threadGroups.${group}`)}
              </h3>
              <ul className="flex flex-col gap-px">
                {items.map((thread) => {
                  const current = thread.id === currentId;
                  return (
                    <li key={thread.id}>
                      <button
                        type="button"
                        onClick={() => onPick(thread.id)}
                        aria-current={current ? 'true' : undefined}
                        title={thread.title || t('untitled')}
                        className={cn(
                          'flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm text-foreground/85 transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                          current && 'bg-muted font-medium text-foreground hover:bg-muted',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {thread.title || t('untitled')}
                        </span>
                        {thread.pinned ? (
                          <Pin
                            className="size-3.5 shrink-0 text-brand-text"
                            aria-label={t('pinned')}
                          />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
