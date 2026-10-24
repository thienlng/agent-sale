import type { InboxMessageDto } from '@agent-sales/contracts';
import { CheckCheck, CircleAlert, Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { MessageAttachments } from './message-attachments';

/** The conversation's messages, scrolled to the newest one. */
export function MessageThread({ messages }: { messages: readonly InboxMessageDto[] }) {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`channelInbox.${key}`);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);
  const stamp = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  return (
    <div
      role="log"
      aria-label={tr('inboxTitle')}
      className="flex min-h-80 flex-1 flex-col gap-4 overflow-y-auto bg-muted/20 p-4 sm:p-6"
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
                m.status === 'failed' || m.status === 'unknown'
                  ? 'text-destructive'
                  : 'text-muted-foreground',
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
      <div ref={bottom} />
    </div>
  );
}
