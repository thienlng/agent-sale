import type { AiDoneItem } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { ChevronDown, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

import { useAiDone } from '../api/care';
import { CHANNELS, CustomerInitial } from './today-item';

/**
 * "AI đã làm" (spec 2026-11-11 care §5): the follow-ups the care agent sent today at level
 * "làm rồi báo", and whether the customer answered. Collapsed by default; absent when empty.
 */
export function AiDoneSection() {
  const { t } = useTranslation('brain');
  const done = useAiDone();
  const [open, setOpen] = useState(false);
  const data = done.data;
  if (!data || data.count === 0) return null;
  const replied = data.items.filter((i) => i.repliedAt !== null).length;
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-xl border bg-card lg:col-span-2"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
        <Sparkles className="size-4 shrink-0 text-ai" aria-hidden />
        <span className="min-w-0 truncate text-sm font-semibold">
          {t('aiDone.title', { count: data.count })}
        </span>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
          {t('aiDone.replied', { count: replied })}
        </span>
        <ChevronDown
          className={cn('ml-auto size-4 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="divide-y border-t">
          {data.items.map((item) => (
            <AiDoneRow key={item.careMessageId} item={item} />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function AiDoneRow({ item }: { item: AiDoneItem }) {
  const { t } = useTranslation('brain');
  return (
    <li className="flex gap-3 px-4 py-3">
      <CustomerInitial name={item.customerName} url={item.avatarUrl} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to="/app/inbox"
            search={{ conversation: item.conversationId }}
            className="min-w-0 max-w-full truncate font-medium hover:underline"
          >
            {item.customerName}
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground">
            {t(`channel.${CHANNELS.has(item.channel) ? item.channel : 'other'}`)}
          </span>
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {t(`care.template.${item.template}`)}
          </span>
          <time
            dateTime={item.sentAt}
            className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums"
          >
            {formatRelativeTime(item.sentAt)}
          </time>
        </div>
        <p className="line-clamp-2 text-sm break-words text-foreground/90">{item.text}</p>
        <p
          className={cn(
            'text-xs',
            item.repliedAt ? 'font-medium text-success' : 'text-muted-foreground',
          )}
        >
          {item.repliedAt ? t('aiDone.customerReplied') : t('aiDone.noReply')}
        </p>
      </div>
    </li>
  );
}
