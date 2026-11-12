import { Menu, Minimize2, SquarePen } from 'lucide-react';
import { type DragEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

import { useAssistantThreads } from '../api/assistant';
import { AssistantThreadList } from './assistant-thread-list';

/** The full page's tabs: the conversation, then the views the sheet keeps behind icons. */
const PAGE_TABS = [
  { view: 'chat', label: 'tabs.chat' },
  { view: 'schedules', label: 'tabs.schedules' },
  { view: 'skills', label: 'tabs.skills' },
  { view: 'memory', label: 'tabs.memory' },
  { view: 'settings', label: 'tabs.settings' },
] as const;
export type AssistantPageView = (typeof PAGE_TABS)[number]['view'];

/**
 * The conversation and the composer keep a readable measure in the middle while their scroll
 * areas stay full width (the measured parts are marked `data-measure`).
 */
const PAGE_MEASURE = cn(
  '[&_[data-measure]]:mx-auto [&_[data-measure]]:w-full [&_[data-measure]]:max-w-3xl',
  // The composer sits as a card above the bottom edge instead of a full-width bar.
  '[&_form[data-measure]]:mb-4 [&_form[data-measure]]:w-[calc(100%-2rem)]',
);

interface DropHandlers {
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

/**
 * The full-page assistant's frame (`/app/assistant`): the tabs across the top (Trò chuyện · Lịch
 * báo cáo · Kỹ năng · Bộ nhớ · Cài đặt) with ⤡ at the end; under "Trò chuyện" the conversations
 * on the left (a drawer on phones and tablets) and the chat at a reading width; the other tabs use
 * the whole width, their content at the same reading width. The panel owns every state; this only
 * lays it out.
 */
export function AssistantPageLayout({
  threadId,
  view,
  onView,
  onPickThread,
  onNewThread,
  onCollapse,
  dropHandlers,
  children,
}: {
  threadId: string | null;
  view: AssistantPageView;
  onView: (view: AssistantPageView) => void;
  onPickThread: (threadId: string) => void;
  onNewThread: () => void;
  onCollapse: () => void;
  dropHandlers: DropHandlers;
  children: ReactNode;
}) {
  const { t } = useTranslation('assistant');
  const [drawer, setDrawer] = useState(false);
  // The open conversation's title for the phone bar: the list's own query, already cached.
  const threads = useAssistantThreads('');
  const threadTitle = threads.data?.find((x) => x.id === threadId)?.title;
  const pick = (id: string) => {
    setDrawer(false);
    onPickThread(id);
  };
  const fresh = () => {
    setDrawer(false);
    onNewThread();
  };
  const newButton = (
    <Button variant="outline" className="w-full justify-start" onClick={fresh}>
      <SquarePen />
      {t('newThread')}
    </Button>
  );
  const chat = view === 'chat';

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-stretch gap-2 border-b px-2 sm:px-4">
        <div
          role="tablist"
          aria-label={t('sections')}
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]"
        >
          {PAGE_TABS.map(({ view: target, label }) => {
            const selected = view === target;
            return (
              <button
                key={target}
                type="button"
                role="tab"
                id={`assistant-tab-${target}`}
                aria-controls="assistant-tabpanel"
                aria-selected={selected}
                onClick={() => onView(target)}
                className={cn(
                  // An underline tab: the bar's bottom border is the track, the selected one is marked.
                  'relative shrink-0 px-2 text-sm sm:px-3 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
                  "after:absolute after:inset-x-2 sm:after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:content-['']",
                  selected && 'font-medium text-foreground after:bg-primary',
                )}
              >
                {t(label)}
              </button>
            );
          })}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 self-center max-sm:hidden"
          aria-label={t('collapse')}
          title={t('collapse')}
          onClick={onCollapse}
        >
          <Minimize2 />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {chat ? (
          <aside
            aria-label={t('threads')}
            className="hidden w-72 shrink-0 flex-col border-r lg:flex"
          >
            <div className="p-3">{newButton}</div>
            <AssistantThreadList currentId={threadId} onPick={pick} />
          </aside>
        ) : null}
        <Sheet open={drawer} onOpenChange={setDrawer}>
          <SheetContent side="left" className="gap-0 p-0">
            <div className="flex flex-col gap-3 px-4 pt-4 pb-3">
              {/* Room on the right for the drawer's own close button. */}
              <SheetTitle className="pr-10 leading-8 font-semibold">{t('threads')}</SheetTitle>
              <SheetDescription className="sr-only">{t('subtitle')}</SheetDescription>
              {newButton}
            </div>
            <AssistantThreadList currentId={threadId} onPick={pick} />
          </SheetContent>
        </Sheet>
        <section
          aria-label={t('title')}
          data-assistant-page
          className={cn('relative flex min-w-0 flex-1 flex-col', PAGE_MEASURE)}
          {...dropHandlers}
        >
          {chat ? (
            // Phones and tablets: the conversations are a drawer; this bar says which one is open.
            <div className="flex h-11 shrink-0 items-center gap-1 border-b px-2 lg:hidden">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('showThreads')}
                onClick={() => setDrawer(true)}
              >
                <Menu />
              </Button>
              <p className="min-w-0 flex-1 truncate px-1 text-sm font-medium">
                {threadId ? threadTitle || t('untitled') : t('newThread')}
              </p>
              <Button variant="ghost" size="icon-sm" aria-label={t('newThread')} onClick={fresh}>
                <SquarePen />
              </Button>
            </div>
          ) : null}
          <div
            id="assistant-tabpanel"
            role="tabpanel"
            aria-labelledby={`assistant-tab-${view}`}
            className="flex min-h-0 flex-1 flex-col"
          >
            {chat ? (
              children
            ) : (
              // The views scroll here, full width; their content keeps a reading width. Their own
              // scroll box and padding (sized for the side sheet) give way to the page's.
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-10 [&>*]:overflow-visible [&>*]:p-0">
                  {children}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
