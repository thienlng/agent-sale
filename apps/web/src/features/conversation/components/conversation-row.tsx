import type { ConversationDto } from '@agent-sales/contracts';
import { Bot, CheckCheck, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { formatDay, previewText } from '../lib/inbox-list';
import { CustomerAvatar } from './customer-avatar';

export function ConversationRow({
  conversation: c,
  active,
  onSelect,
  channelName,
}: {
  conversation: ConversationDto;
  active: boolean;
  onSelect: () => void;
  channelName?: string | undefined;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.${key}`);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50',
          active && 'bg-primary-soft/60 shadow-[inset_3px_0_0_var(--primary)]',
        )}
      >
        <CustomerAvatar conversation={c} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold">{c.customerName}</span>
            {c.status === 'resolved' ? (
              <CheckCheck className="size-3.5 shrink-0 text-success" aria-label={tr('resolved')} />
            ) : null}
          </span>
          {channelName ? (
            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
              {channelName}
            </span>
          ) : null}
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {previewText(c.lastMessage, tr)}
          </span>
          <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1">
              {c.mode === 'bot' ? <Bot className="size-3" /> : <UserRound className="size-3" />}
              <span className="truncate">
                {tr(c.assigneeId ? 'sales.assigned' : 'sales.unassigned')}
              </span>
            </span>
            <time className="shrink-0" dateTime={c.updatedAt}>
              {formatDay(c.updatedAt)}
            </time>
          </span>
        </span>
      </button>
    </li>
  );
}
