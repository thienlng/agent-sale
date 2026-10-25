import type { InboxMessageDto } from '@agent-sales/contracts';
import { ArrowDown, CheckCheck, CircleAlert, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MessageAttachments } from './message-attachments';

/** The conversation's messages, scrolled to the newest one. */
export function MessageThread({ messages }: { messages: readonly InboxMessageDto[] }) {
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
          <div
            key={m.id}
            className={cn(
              'flex max-w-[88%] flex-col',
              m.direction === 'outbound' ? 'self-end items-end' : 'self-start items-start',
            )}
          >
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
