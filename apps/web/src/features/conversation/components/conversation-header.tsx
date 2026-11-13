import {
  ArrowLeft,
  Check,
  ExternalLink,
  Mail,
  MoreHorizontal,
  OctagonAlert,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Search,
  Star,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { customerDisplayName, formatRowTime, providerLabel } from '../lib/inbox-list';
import type { InboxConversation, InboxUpdateBody } from '../lib/inbox-v2-types';
import { AssigneeMenu } from './assignee-menu';
import { CustomerAvatar } from './customer-avatar';
import { Hint } from './hint';
import type { FilterMember } from './inbox-filter-popover';
import { ReplyModeMenu } from './reply-mode-menu';

export interface HeaderChannel {
  name: string;
  externalId: string;
  /** Removed from Rapiz (T-133): history stays readable, replies are not possible. */
  removed?: boolean;
}

/** Meta Business Suite inbox of the page; there is no stable per-thread link. */
export function externalInboxUrl(
  provider: 'facebook' | 'instagram' | 'website',
  channel: HeaderChannel | undefined,
): string | null {
  if (provider !== 'facebook' || !channel?.externalId) return null;
  return `https://business.facebook.com/latest/inbox/all?asset_id=${encodeURIComponent(channel.externalId)}`;
}

/** Below this width the header keeps one row by moving star, spam and "mark unread" into "…" (LM-8). */
const COMPACT_WIDTH = 600;

/** Whether the element is narrower than `width`; false until it is measured. */
function useNarrow(width: number) {
  const ref = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? 0;
      setNarrow(w > 0 && w < width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);
  return [ref, narrow] as const;
}

/** Meta's square outlined icon action with a tooltip; `pressed` marks an on/off state. */
function IconAction({
  label,
  pressed,
  disabled,
  onClick,
  shortcut,
  children,
}: {
  label: string;
  pressed?: boolean | undefined;
  disabled?: boolean | undefined;
  onClick: () => void;
  shortcut?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Hint label={shortcut ? `${label} (${shortcut})` : label}>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={shortcut}
        disabled={disabled}
        onClick={onClick}
        className={cn(pressed && 'border-primary/40 bg-primary-soft text-brand-text')}
      >
        {children}
      </Button>
    </Hint>
  );
}

/**
 * Customer and assignee on the left (Meta's "Chỉ định cuộc trò chuyện này"); the reply mode,
 * then spam, star, unread and done as icon actions on the right.
 */
export function ConversationHeader({
  conversation: c,
  channel,
  botAvailable,
  takeoverMinutes,
  members,
  membersLoading,
  userId,
  busy,
  now,
  detailsOpen,
  onToggleDetails,
  onBack,
  onToggleSearch,
  onChange,
  onMarkUnread,
  canEdit = true,
  replyModeLocked = false,
}: {
  conversation: InboxConversation;
  channel: HeaderChannel | undefined;
  botAvailable: boolean;
  takeoverMinutes: number | undefined;
  members: readonly FilterMember[];
  membersLoading: boolean;
  userId: string;
  busy: boolean;
  now: number;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onBack: () => void;
  onToggleSearch: () => void;
  onChange: (body: InboxUpdateBody) => void;
  onMarkUnread: () => void;
  /** Every control change needs permission to edit contacts. */
  canEdit?: boolean;
  /** The Page was removed: neither the bot nor a person can answer here (TM-10). */
  replyModeLocked?: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.${key}`, options ?? {});
  const v2 = (key: string, options?: Record<string, unknown>) => tr(`v2.header.${key}`, options);
  const meta = (key: string) => tr(`meta.header.${key}`);
  const name = customerDisplayName(c, (provider, last4) => tr('v2.row.guest', { provider, last4 }));
  const provider = providerLabel(c.provider);
  const resolved = c.status === 'resolved';
  const spam = c.status === 'spam';
  const link = externalInboxUrl(c.provider, channel);
  const seenAt = c.lastReadAt ? formatRowTime(c.lastReadAt, now) : null;
  const locked = busy || !canEdit;
  const [headerRef, compact] = useNarrow(COMPACT_WIDTH);
  const seen =
    c.unreadCount > 0 ? (
      <span className="font-medium text-brand-text">{v2('unseen')}</span>
    ) : seenAt && c.lastReadBy?.userId !== userId ? (
      c.lastReadBy?.name ? (
        v2('seenBy', { name: c.lastReadBy.name, time: seenAt })
      ) : (
        v2('seen', { time: seenAt })
      )
    ) : null;
  return (
    <header
      ref={headerRef}
      className="flex items-center gap-x-2 gap-y-2 border-b px-2 py-2.5 sm:gap-x-3 sm:px-3"
    >
      <Button
        size="icon-sm"
        variant="ghost"
        className="md:hidden"
        aria-label={tr('back')}
        onClick={onBack}
      >
        <ArrowLeft />
      </Button>
      <CustomerAvatar conversation={c} name={name} />
      <div className="min-w-14 flex-1 sm:min-w-24">
        <h2 className="flex min-w-0 items-baseline gap-2 leading-tight">
          <span className="min-w-0 truncate font-semibold sm:max-w-full sm:shrink-0">{name}</span>
          <span className="hidden truncate text-xs font-normal text-muted-foreground sm:inline">
            {channel?.name ? v2('via', { provider, page: channel.name }) : provider}
          </span>
        </h2>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <AssigneeMenu
            variant="link"
            assigneeId={c.assigneeId}
            members={members}
            loading={membersLoading}
            userId={userId}
            disabled={locked}
            onAssign={(assigneeId) => onChange({ assigneeId })}
          />
          {seen ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{seen}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 shrink items-center gap-1.5 [&>*:not(:first-child)]:shrink-0">
        <ReplyModeMenu
          mode={c.mode}
          autoResumeAt={c.autoResumeAt}
          takeover={c.takeover}
          isMine={c.assigneeId === userId}
          botAvailable={botAvailable}
          takeoverMinutes={takeoverMinutes}
          disabled={locked || replyModeLocked}
          compact={compact}
          onChange={(change) => onChange(change)}
        />
        {compact ? null : (
          <IconAction
            label={meta(spam ? 'notSpam' : 'spam')}
            pressed={spam}
            disabled={locked}
            onClick={() => onChange({ status: spam ? 'open' : 'spam' })}
          >
            <OctagonAlert />
          </IconAction>
        )}
        {compact ? null : (
          <IconAction
            label={meta(c.starred ? 'unstar' : 'star')}
            pressed={c.starred}
            disabled={locked}
            onClick={() => onChange({ starred: !c.starred })}
          >
            <Star className={cn(c.starred && 'fill-current')} />
          </IconAction>
        )}
        {compact ? null : (
          <IconAction label={v2('markUnread')} disabled={locked} onClick={onMarkUnread}>
            <Mail />
          </IconAction>
        )}
        <IconAction
          label={v2(resolved ? 'reopen' : 'resolve')}
          pressed={resolved}
          disabled={locked}
          shortcut="E"
          onClick={() => onChange({ status: resolved ? 'open' : 'resolved' })}
        >
          {resolved ? <RotateCcw /> : <Check />}
        </IconAction>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={v2('more')}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {compact ? (
              <>
                <DropdownMenuItem
                  disabled={locked}
                  onSelect={() => onChange({ starred: !c.starred })}
                >
                  <Star className={cn(c.starred && 'fill-current')} />
                  {meta(c.starred ? 'unstar' : 'star')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={locked} onSelect={onMarkUnread}>
                  <Mail />
                  {v2('markUnread')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={locked}
                  onSelect={() => onChange({ status: spam ? 'open' : 'spam' })}
                >
                  <OctagonAlert />
                  {meta(spam ? 'notSpam' : 'spam')}
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuItem onSelect={onToggleSearch}>
              <Search />
              {tr('sales.searchThread')}
            </DropdownMenuItem>
            {link ? (
              <DropdownMenuItem asChild>
                <a href={link} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  {v2('openOn', { provider })}
                </a>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <Hint label={tr(detailsOpen ? 'sales.collapsePanel' : 'details')}>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-expanded={detailsOpen}
            aria-label={tr(detailsOpen ? 'sales.collapsePanel' : 'details')}
            onClick={onToggleDetails}
          >
            {detailsOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
        </Hint>
      </div>
    </header>
  );
}
