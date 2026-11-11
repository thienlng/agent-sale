import type { TodayItem as TodayItemDto } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import {
  ClipboardPlus,
  EyeOff,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  PenLine,
  RefreshCw,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

import { StageBadge, StageMenu } from './stage-menu';

const CHANNEL_LABEL: Record<string, string> = {
  facebook: 'Messenger',
  instagram: 'Instagram',
  website: 'Website',
};

/** The customer's photo, or their initial. */
export function CustomerInitial({ name, url }: { name: string; url: string | null }) {
  const [failed, setFailed] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-primary-soft text-sm font-semibold text-brand-text">
      {url && !failed ? (
        <img
          src={url}
          alt=""
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden>{initial}</span>
      )}
    </span>
  );
}

export interface ItemHandlers {
  onDraft: (conversationId: string) => void;
  onEvaluate: (conversationId: string) => void;
  onDismiss: (conversationId: string) => void;
  onAddTask: (item: TodayItemDto) => void;
  /** The conversation whose draft or evaluation is running, if any. */
  drafting?: string | undefined;
  evaluating?: string | undefined;
  canAct: boolean;
}

/**
 * One customer on Today: who, which channel, why, since when, the stage and the assignee, with
 * the actions. From `sm` up the main actions are buttons; on a phone they all sit in the menu.
 */
export function TodayItem({
  item,
  handlers,
  queue,
}: {
  item: TodayItemDto;
  handlers: ItemHandlers;
  /** Its queue: an unanswered customer without a note reads "waiting for a reply". */
  queue?: string | undefined;
}) {
  const { t } = useTranslation('brain');
  const id = item.conversationId;
  const drafting = handlers.drafting === id;
  const evaluating = handlers.evaluating === id;
  const open = (
    <Link to="/app/inbox" search={{ conversation: id }}>
      <MessageSquareText aria-hidden />
      {t('item.open')}
    </Link>
  );
  return (
    <li className="flex gap-3 px-4 py-3">
      <CustomerInitial name={item.customerName} url={item.avatarUrl} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to="/app/inbox"
            search={{ conversation: id }}
            className="min-w-0 truncate font-medium hover:underline"
          >
            {item.customerName}
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground">
            {CHANNEL_LABEL[item.channel] ?? item.channel}
          </span>
          <time
            dateTime={item.at}
            title={new Date(item.at).toLocaleString()}
            className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums"
          >
            {formatRelativeTime(item.at)}
          </time>
        </div>
        <p
          className={cn(
            'line-clamp-2 text-sm break-words',
            item.reason ? 'text-foreground/90' : 'text-muted-foreground',
          )}
        >
          {item.reason || (queue === 'unanswered' ? t('item.waitingReply') : t('item.noReason'))}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          <StageBadge stage={item.stage} locked={item.stageLocked} />
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {item.assigneeName ?? (item.assigneeId ? '—' : t('item.unassigned'))}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button asChild variant="outline" size="xs" className="hidden sm:inline-flex">
              {open}
            </Button>
            {handlers.canAct ? (
              <>
                <Button
                  variant="outline"
                  size="xs"
                  className="hidden sm:inline-flex"
                  disabled={drafting}
                  onClick={() => handlers.onDraft(id)}
                >
                  {drafting ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <PenLine aria-hidden />
                  )}
                  {drafting ? t('item.drafting') : t('item.draft')}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="hidden 2xl:inline-flex"
                  onClick={() => handlers.onAddTask(item)}
                >
                  <ClipboardPlus aria-hidden />
                  {t('item.addTask')}
                </Button>
              </>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('item.more', { name: item.customerName })}
                >
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuItem asChild className="sm:hidden">
                  {open}
                </DropdownMenuItem>
                {handlers.canAct ? (
                  <>
                    <DropdownMenuItem
                      className="sm:hidden"
                      disabled={drafting}
                      onSelect={() => handlers.onDraft(id)}
                    >
                      <PenLine aria-hidden />
                      {t('item.draft')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="2xl:hidden"
                      onSelect={() => handlers.onAddTask(item)}
                    >
                      <ClipboardPlus aria-hidden />
                      {t('item.addTask')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={evaluating}
                      onSelect={() => handlers.onEvaluate(id)}
                    >
                      <RefreshCw className={cn(evaluating && 'animate-spin')} aria-hidden />
                      {t('item.evaluate')}
                    </DropdownMenuItem>
                    <StageMenu conversationId={id} stage={item.stage} locked={item.stageLocked} />
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                <DropdownMenuItem onSelect={() => handlers.onDismiss(id)}>
                  <EyeOff aria-hidden />
                  {t('item.dismiss')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </li>
  );
}
