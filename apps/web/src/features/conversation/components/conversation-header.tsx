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
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { customerDisplayName, formatRowTime } from '../lib/inbox-list';
import type { InboxConversation, InboxUpdateBody } from '../lib/inbox-v2-types';
import { AssigneeMenu } from './assignee-menu';
import { CustomerAvatar } from './customer-avatar';
import { Hint } from './hint';
import type { FilterMember } from './inbox-filter-popover';
import { ReplyModeMenu } from './reply-mode-menu';

export interface HeaderChannel {
  name: string;
  externalId: string;
}

/** Meta Business Suite inbox of the page; there is no stable per-thread link. */
export function externalInboxUrl(
  provider: 'facebook' | 'instagram' | 'website',
  channel: HeaderChannel | undefined,
): string | null {
  if (provider !== 'facebook' || !channel?.externalId) return null;
  return `https://business.facebook.com/latest/inbox/all?asset_id=${encodeURIComponent(channel.externalId)}`;
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
        className={cn(pressed && 'border-primary/40 bg-primary-soft text-primary')}
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
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.${key}`, options ?? {});
  const v2 = (key: string, options?: Record<string, unknown>) => tr(`v2.header.${key}`, options);
  const meta = (key: string) => tr(`meta.header.${key}`);
  const name = customerDisplayName(c, (provider, last4) => tr('v2.row.guest', { provider, last4 }));
  const provider = { facebook: 'Facebook', instagram: 'Instagram', website: 'Website' }[c.provider];
  const resolved = c.status === 'resolved';
  const spam = c.status === 'spam';
  const link = externalInboxUrl(c.provider, channel);
  const seenAt = c.lastReadAt ? formatRowTime(c.lastReadAt, now) : null;
  const locked = busy || !canEdit;
  const seen =
    c.unreadCount > 0 ? (
      <span className="font-medium text-primary">{v2('unseen')}</span>
    ) : seenAt && c.lastReadBy?.userId !== userId ? (
      c.lastReadBy?.name ? (
        v2('seenBy', { name: c.lastReadBy.name, time: seenAt })
      ) : (
        v2('seen', { time: seenAt })
      )
    ) : null;
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2.5">
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
      <div className="min-w-0 flex-1 basis-40">
        <h2 className="flex min-w-0 items-baseline gap-2 leading-tight">
          <span className="truncate font-semibold">{name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
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
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <ReplyModeMenu
          mode={c.mode}
          autoResumeAt={c.autoResumeAt}
          takeover={c.takeover}
          isMine={c.assigneeId === userId}
          botAvailable={botAvailable}
          takeoverMinutes={takeoverMinutes}
          disabled={locked}
          onChange={(change) => onChange(change)}
        />
        <IconAction
          label={meta(spam ? 'notSpam' : 'spam')}
          pressed={spam}
          disabled={locked}
          onClick={() => onChange({ status: spam ? 'open' : 'spam' })}
        >
          <OctagonAlert />
        </IconAction>
        <IconAction
          label={meta(c.starred ? 'unstar' : 'star')}
          pressed={c.starred}
          disabled={locked}
          onClick={() => onChange({ starred: !c.starred })}
        >
          <Star className={cn(c.starred && 'fill-current')} />
        </IconAction>
        <IconAction label={v2('markUnread')} disabled={locked} onClick={onMarkUnread}>
          <Mail />
        </IconAction>
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
