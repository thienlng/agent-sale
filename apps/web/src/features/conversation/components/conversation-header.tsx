import {
  ArrowLeft,
  Check,
  ExternalLink,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { customerDisplayName, formatRowTime } from '../lib/inbox-list';
import type { InboxConversation, InboxUpdateBody } from '../lib/inbox-v2-types';
import { AssigneeMenu } from './assignee-menu';
import { CustomerAvatar } from './customer-avatar';
import type { FilterMember } from './inbox-filter-popover';
import { ReplyModeMenu } from './reply-mode-menu';

export interface HeaderChannel {
  name: string;
  externalId: string;
}

/** Meta Business Suite inbox of the page; there is no stable per-thread link. */
export function externalInboxUrl(
  provider: 'facebook' | 'instagram',
  channel: HeaderChannel | undefined,
): string | null {
  if (provider !== 'facebook' || !channel?.externalId) return null;
  return `https://business.facebook.com/latest/inbox/all?asset_id=${encodeURIComponent(channel.externalId)}`;
}

/** Name and channel on the left, seen-by line below; reply mode, assignee, done and more on the right. */
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
  /** Marking unread needs permission to edit contacts. */
  canEdit?: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.${key}`, options ?? {});
  const v2 = (key: string, options?: Record<string, unknown>) => tr(`v2.header.${key}`, options);
  const name = customerDisplayName(c, (provider, last4) => tr('v2.row.guest', { provider, last4 }));
  const provider = c.provider === 'facebook' ? 'Facebook' : 'Instagram';
  const resolved = c.status === 'resolved';
  const link = externalInboxUrl(c.provider, channel);
  const seenAt = c.lastReadAt ? formatRowTime(c.lastReadAt, now) : null;
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
      <Button
        size="icon-sm"
        variant="ghost"
        className="md:hidden"
        aria-label={tr('back')}
        onClick={onBack}
      >
        <ArrowLeft />
      </Button>
      <CustomerAvatar conversation={c} name={name} size="sm" />
      <div className="min-w-0 flex-1 basis-40">
        <h2 className="flex min-w-0 items-baseline gap-2 leading-tight">
          <span className="truncate font-semibold">{name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {channel?.name ? v2('via', { provider, page: channel.name }) : provider}
          </span>
        </h2>
        {seenAt ? (
          <p className="truncate text-xs text-muted-foreground">
            {c.lastReadBy?.name
              ? v2('seenBy', { name: c.lastReadBy.name, time: seenAt })
              : v2('seen', { time: seenAt })}
          </p>
        ) : (
          <p className="truncate text-xs font-medium text-primary">{v2('unseen')}</p>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <ReplyModeMenu
          mode={c.mode}
          autoResumeAt={c.autoResumeAt}
          botAvailable={botAvailable}
          takeoverMinutes={takeoverMinutes}
          disabled={busy}
          onChange={(mode) => onChange({ mode })}
        />
        <AssigneeMenu
          assigneeId={c.assigneeId}
          members={members}
          loading={membersLoading}
          userId={userId}
          disabled={busy}
          onAssign={(assigneeId) => onChange({ assigneeId })}
        />
        <Button
          size="sm"
          variant={resolved ? 'secondary' : 'outline'}
          aria-keyshortcuts="E"
          title={`${v2(resolved ? 'reopen' : 'resolve')} (E)`}
          disabled={busy}
          onClick={() => onChange({ status: resolved ? 'open' : 'resolved' })}
        >
          {resolved ? <RotateCcw /> : <Check />}
          {v2(resolved ? 'reopen' : 'resolve')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={v2('more')}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {canEdit ? (
              <DropdownMenuItem onSelect={onMarkUnread}>{v2('markUnread')}</DropdownMenuItem>
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
        <Button
          size="icon-sm"
          variant="ghost"
          aria-expanded={detailsOpen}
          aria-label={tr(detailsOpen ? 'sales.collapsePanel' : 'details')}
          title={tr(detailsOpen ? 'sales.collapsePanel' : 'details')}
          onClick={onToggleDetails}
        >
          {detailsOpen ? <PanelRightClose /> : <PanelRightOpen />}
        </Button>
      </div>
    </header>
  );
}
