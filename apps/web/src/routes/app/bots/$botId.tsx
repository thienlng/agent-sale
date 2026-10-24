import { fillPlaceholders, placeholdersIn } from '@agent-sales/shared';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NotFound } from '@/components/route-errors';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { TestChat } from '@/features/ai/components/test-chat';
import { useBot } from '@/features/bot/api/bots';
import { TrainingNav } from '@/features/bot/components/training-nav';
import { BotHeader } from '@/features/bot/components/bot-header';
import { ApiClientError } from '@/lib/api-client';

/** Bot space: header + section content, with the test chat docked on the right (docs/03 §3). */
export const Route = createFileRoute('/app/bots/$botId')({
  component: BotSpace,
});

function BotSpace() {
  const { t } = useTranslation();
  const { t: training } = useTranslation('training');
  const { botId } = Route.useParams();
  const bot = useBot(botId);
  const [chatOpen, setChatOpen] = useState(true);
  const [mobileChat, setMobileChat] = useState(false);

  if (bot.error instanceof ApiClientError && bot.error.status === 404) return <NotFound />;
  if (bot.isError && !bot.data)
    return (
      <div role="alert" className="space-y-3">
        <p>{training('error')}</p>
        <Button variant="outline" onClick={() => void bot.refetch()}>
          {training('retry')}
        </Button>
      </div>
    );
  if (!bot.data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  // Same filling the bot applies before greeting a real customer; a greeting
  // with an unfilled placeholder is not sent, so it is not shown either.
  const filled = fillPlaceholders(bot.data.settings.greeting, bot.data.settings.placeholders);
  const greeting = placeholdersIn(filled).length ? '' : filled;
  const chat = (onHide?: () => void) => (
    <TestChat
      key={bot.data.id}
      botId={bot.data.id}
      greeting={greeting}
      {...(onHide ? { onHide } : {})}
    />
  );

  return (
    // Full-bleed in the shell; the test chat docks on the right from xl and is a sheet below.
    <div data-content-padding="false" className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <BotHeader bot={bot.data} />
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <TrainingNav botId={botId} />
          <div className="min-w-0 flex-1 p-4 md:p-6">
            <Outlet />
          </div>
        </div>
      </div>

      {chatOpen ? (
        <aside className="chat-dock sticky hidden w-[380px] shrink-0 self-start border-l xl:flex xl:flex-col">
          {chat(() => setChatOpen(false))}
        </aside>
      ) : null}

      <Button
        className={`fixed right-5 bottom-5 z-20 h-11 rounded-full px-4 shadow-lg ${chatOpen ? 'xl:hidden' : ''}`}
        onClick={() =>
          window.matchMedia('(min-width: 80rem)').matches ? setChatOpen(true) : setMobileChat(true)
        }
      >
        <MessageSquareText />
        {t('playground.show')}
      </Button>
      <Sheet open={mobileChat} onOpenChange={setMobileChat}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-md">
          <SheetTitle className="sr-only">{t('playground.title')}</SheetTitle>
          {chat()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
