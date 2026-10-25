import type { InboxMessageDto } from '@agent-sales/contracts';
import { ArrowDown, Bot, CheckCheck, CircleAlert, Loader2 } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MessageAttachments } from './message-attachments';

/** The conversation's messages, scrolled to the newest one. */
export function MessageThread({
  messages,
  newAfter = null,
}: {
  messages: readonly InboxMessageDto[];
  /** Read time when the conversation was opened; the first later customer message starts "Tin mới". */
  newAfter?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`channelInbox.${key}`);
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [readingHistory, setReadingHistory] = useState(false);
  const latestId = messages.at(-1)?.id ?? null;
  const [seenLatest, setSeenLatest] = useState(latestId);
  useEffect(() => {
    if (nearBottom.current && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [latestId]);
  function jumpToLatest() {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
    nearBottom.current = true;
    setReadingHistory(false);
    setSeenLatest(latestId);
  }
  const dividerId = newAfter
    ? (messages.find(
        (m) => m.direction === 'inbound' && Date.parse(m.createdAt) > Date.parse(newAfter),
      )?.id ?? null)
    : null;
  const stamp = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          setReadingHistory(!nearBottom.current);
          if (nearBottom.current) setSeenLatest(latestId);
        }}
        role="log"
        aria-label={tr('inboxTitle')}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain bg-muted/20 p-4 sm:p-6"
      >
        {messages.map((m) => (
          <Fragment key={m.id}>
            {m.id === dividerId ? (
              <div
                role="separator"
                className="flex items-center gap-2 text-[11px] font-medium text-primary"
              >
                <span className="h-px flex-1 bg-primary/40" />
                {t('channelInbox.v2.thread.newDivider')}
                <span className="h-px flex-1 bg-primary/40" />
              </div>
            ) : null}
            <div
              className={cn(
                'flex max-w-[88%] flex-col',
                m.direction === 'outbound' ? 'self-end items-end' : 'self-start items-start',
              )}
            >
              {m.sender === 'bot' ? (
                <span className="mb-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-primary">
                  <Bot className="size-3" aria-hidden />
                  {t('channelInbox.v2.thread.bot')}
                </span>
              ) : null}
              <div
                className={cn(
                  'rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words',
                  m.direction === 'outbound'
                    ? 'rounded-br-sm bg-primary-soft text-foreground'
                    : 'rounded-bl-sm border bg-background',
                )}
              >
                <MessageAttachments items={m.attachments} />
                {m.text || (m.attachments.length ? null : tr('noMessage'))}
              </div>
              <span className="mt-1 text-[10px] text-muted-foreground">
                {stamp(m.createdAt)}
                {m.direction === 'outbound'
                  ? ` · ${tr(m.sender === 'bot' ? 'botSent' : 'humanSent')}`
                  : ''}
              </span>
              {m.direction === 'outbound' ? (
                <span
                  className={cn(
                    'mt-0.5 flex items-center gap-1 text-[10px]',
                    m.status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {m.status === 'sent' ? (
                    <CheckCheck className="size-3" />
                  ) : m.status === 'pending' ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <CircleAlert className="size-3" />
                  )}
                  {tr(m.status)}
                </span>
              ) : null}
            </div>
          </Fragment>
        ))}
      </div>
      {readingHistory && latestId !== seenLatest ? (
        <Button
          size="sm"
          variant="secondary"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md"
          onClick={jumpToLatest}
        >
          <ArrowDown className="size-4" />
          {tr('sales.newMessages')}
        </Button>
      ) : null}
    </div>
  );
}
