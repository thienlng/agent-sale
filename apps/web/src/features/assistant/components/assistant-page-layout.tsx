import { List, Minimize2, SquarePen } from 'lucide-react';
import { type DragEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

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
 * The conversation, the composer and the views keep a readable measure in the middle while their
 * scroll areas stay full width (the measured parts are marked `data-measure`).
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
 * The full-page assistant's frame (`/app/assistant`): conversations on the left (a drawer on
 * phones and tablets), the views as tabs, and `children` (the current view) at a reading width.
 * The panel owns every state; this only lays it out.
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

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <aside aria-label={t('threads')} className="hidden w-72 shrink-0 flex-col border-r lg:flex">
        <div className="p-3">{newButton}</div>
        <AssistantThreadList currentId={threadId} onPick={pick} />
      </aside>
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
        <header className="flex shrink-0 items-center gap-1 border-b px-2 py-2 sm:px-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={t('showThreads')}
            onClick={() => setDrawer(true)}
          >
            <List />
          </Button>
          <div
            role="tablist"
            aria-label={t('title')}
            className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]"
          >
            {PAGE_TABS.map(({ view: target, label }) => (
              <button
                key={target}
                type="button"
                role="tab"
                id={`assistant-tab-${target}`}
                aria-controls="assistant-tabpanel"
                aria-selected={view === target}
                onClick={() => onView(target)}
                className={cn(
                  'shrink-0 rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  view === target && 'bg-muted font-medium text-foreground',
                )}
              >
                {t(label)}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={t('newThread')}
            onClick={fresh}
          >
            <SquarePen />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            // Phones: the sheet is full width anyway, and the tabs need the room.
            className="max-sm:hidden"
            aria-label={t('collapse')}
            title={t('collapse')}
            onClick={onCollapse}
          >
            <Minimize2 />
          </Button>
        </header>
        <div
          id="assistant-tabpanel"
          role="tabpanel"
          aria-labelledby={`assistant-tab-${view}`}
          className="flex min-h-0 flex-1 flex-col"
        >
          {view === 'chat' ? (
            children
          ) : (
            // The views scroll here, full width, so the scrollbar sits at the edge; their content
            // keeps a reading width. Their own scroll box and padding (sized for the side sheet)
            // give way to the page's.
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-8 [&>*]:overflow-visible [&>*]:p-0">
                {children}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
