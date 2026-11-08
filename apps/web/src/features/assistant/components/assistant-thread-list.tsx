import { Pin, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { useAssistantThreads } from '../api/assistant';

/** The owner's conversations, pinned first, searchable (300 ms debounce, `q`). */
export function AssistantThreadList({
  currentId,
  onPick,
}: {
  currentId: string | null;
  onPick: (threadId: string) => void;
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative px-4 pt-1 pb-3">
        <Search
          className="pointer-events-none absolute top-1/2 left-6.5 size-4 -translate-y-[calc(50%+4px)] text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          aria-label={t('search')}
          placeholder={t('search')}
          value={text}
          maxLength={200}
          className="pl-8"
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {threads.isPending ? (
          <div className="flex flex-col gap-2 px-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : threads.isError ? (
          <p className="px-2 text-sm text-destructive">{t('loadError')}</p>
        ) : threads.data.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">
            {q ? t('noResults') : t('noThreads')}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {threads.data.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => onPick(thread.id)}
                  aria-current={thread.id === currentId ? 'true' : undefined}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-offset-3 focus-visible:ring-offset-background focus-visible:ring-ring focus-visible:outline-none',
                    thread.id === currentId && 'bg-muted font-medium',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{thread.title || t('untitled')}</span>
                  {thread.pinned ? (
                    <Pin className="size-3.5 shrink-0 text-brand-text" aria-label={t('pinned')} />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
