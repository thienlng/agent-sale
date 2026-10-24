import { Bot, MessageSquareText, MessagesSquare, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Right pane when no conversation is open: a small icon illustration and a hint. */
export function InboxEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="hidden min-w-0 flex-1 flex-col items-center justify-center bg-muted/20 p-8 text-center md:flex">
      <div className="relative size-48" aria-hidden>
        <span className="absolute inset-4 rounded-full bg-primary-soft" />
        <span className="absolute top-10 left-1/2 grid size-24 -translate-x-1/2 place-items-center rounded-3xl border bg-background text-primary shadow-sm">
          <MessagesSquare className="size-12" />
        </span>
        <span className="absolute top-6 left-4 grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <Bot className="size-6" />
        </span>
        <span className="absolute right-3 bottom-8 grid size-11 place-items-center rounded-2xl border bg-background text-muted-foreground shadow-sm">
          <MessageSquareText className="size-5" />
        </span>
        <Sparkles className="absolute top-3 right-8 size-5 text-warning" />
      </div>
      <h2 className="mt-6 text-xl font-semibold text-primary">
        {t('channelInbox.inbox.emptyTitle')}
      </h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        {t('channelInbox.inbox.emptyBody')}
      </p>
    </div>
  );
}
