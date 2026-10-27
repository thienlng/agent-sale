import type { InboxConversation, InboxMessage } from '../lib/inbox-v2-types';
import { CustomerAvatar } from './customer-avatar';
import { ArrowDown, Bot, CircleAlert, Loader2 } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MessageAttachments } from './message-attachments';

/** The conversation's messages, scrolled to the newest one. */
export function MessageThread({
  messages,
  newAfter = null,
  newUnread = 0,
  customer,
}: {
  messages: readonly InboxMessage[];
  /** The customer's avatar beside their last bubble of a run, as in Messenger. */
  customer?: { conversation: InboxConversation; name: string } | undefined;
  /** Read time when the conversation was opened; the first later customer message starts "Tin mới". */
  newAfter?: string | null;
  /** Never read (after "mark unread"): the divider goes before the last N customer messages. */
  newUnread?: number;
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
  const inbound = messages.filter((m) => m.direction === 'inbound');
  const dividerId = newAfter
    ? (inbound.find((m) => Date.parse(m.createdAt) > Date.parse(newAfter))?.id ?? null)
    : newUnread > 0
      ? (inbound.slice(-newUnread)[0]?.id ?? null)
      : null;
  const stamp = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(
      new Date(value),
    );
  // Messenger-style centred time between runs: weekday within a week, else the date.
  const gapLabel = (value: string) => {
    const at = new Date(value);
    const recent = Date.now() - at.getTime() < 6 * 86400000;
    return new Intl.DateTimeFormat(i18n.language, {
      ...(recent ? { weekday: 'short' } : { day: 'numeric', month: 'numeric', year: 'numeric' }),
      hour: '2-digit',
      minute: '2-digit',
    }).format(at);
  };
  const sameRun = (a: InboxMessage | undefined, b: InboxMessage | undefined) =>
    Boolean(
      a &&
      b &&
      a.direction === b.direction &&
      a.sender === b.sender &&
      (a.senderName ?? null) === (b.senderName ?? null),
    );
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
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain bg-background p-4 sm:px-6"
      >
        {messages.map((m, index) => {
          const previous = messages[index - 1];
          const next = messages[index + 1];
          const gap =
            !previous || Date.parse(m.createdAt) - Date.parse(previous.createdAt) >= 30 * 60000;
          const firstOfRun = gap || !sameRun(previous, m);
          const lastOfRun =
            !sameRun(m, next) ||
            (next !== undefined &&
              Date.parse(next.createdAt) - Date.parse(m.createdAt) >= 30 * 60000);
          const inbound = m.direction === 'inbound';
          return (
            <Fragment key={m.id}>
              {gap ? (
                <p className="py-2 text-center text-[11px] text-muted-foreground">
                  {gapLabel(m.createdAt)}
                </p>
              ) : null}
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
                  'flex max-w-[78%] flex-col',
                  inbound ? 'relative self-start items-start pl-9' : 'self-end items-end',
                  firstOfRun && index > 0 && 'mt-2',
                )}
              >
                {inbound && customer && lastOfRun ? (
                  <span className="absolute bottom-0 left-0">
                    <CustomerAvatar
                      conversation={customer.conversation}
                      name={customer.name}
                      size="xs"
                      badge={false}
                    />
                  </span>
                ) : null}
                {m.sender === 'bot' && firstOfRun ? (
                  <span className="mb-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-primary">
                    <Bot className="size-3" aria-hidden />
                    {t('channelInbox.v2.thread.bot')}
                  </span>
                ) : null}
                <div
                  title={stamp(m.createdAt)}
                  className={cn(
                    'rounded-[18px] px-3.5 py-2 text-[15px] leading-snug whitespace-pre-wrap break-words',
                    inbound ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground',
                    m.status === 'failed' && 'opacity-70',
                  )}
                >
                  <MessageAttachments items={m.attachments} />
                  {m.text || (m.attachments.length ? null : tr('noMessage'))}
                </div>
                {!inbound && (lastOfRun || m.status !== 'sent') ? (
                  <span className="mt-0.5 text-[10px] text-muted-foreground">
                    {stamp(m.createdAt)}
                    {` · ${m.sender === 'bot' ? tr('botSent') : (m.senderName?.trim() ?? '') || tr('humanSent')}`}
                  </span>
                ) : null}
                {!inbound && m.status !== 'sent' ? (
                  <span
                    className={cn(
                      'mt-0.5 flex items-center gap-1 text-[10px]',
                      m.status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {m.status === 'pending' ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <CircleAlert className="size-3" />
                    )}
                    {tr(m.status)}
                  </span>
                ) : null}
              </div>
            </Fragment>
          );
        })}
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
