import {
  Bot,
  Check,
  CheckCheck,
  Clock,
  MoreHorizontal,
  OctagonAlert,
  Phone,
  Star,
  UserRound,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  compactWait,
  customerDisplayName,
  formatRowTime,
  previewText,
  URGENT_WAIT_MINUTES,
  waitMinutes,
} from '../lib/inbox-list';
import { hasNewLead } from '../lib/lead-alerts';
import type { InboxConversation } from '../lib/inbox-v2-types';
import { ChannelBadge, CustomerAvatar } from './customer-avatar';
import type { FilterMember } from './inbox-filter-popover';
import { TagChip } from './tag-chip';

const MAX_TAGS = 3;

export interface RowActions {
  onMarkUnread: (id: string) => void;
  onMarkRead: (id: string) => void;
  /** `null` removes the assignee. */
  onAssign: (id: string, assigneeId: string | null) => void;
}

/** One conversation: who, what was said, who must act next, and the labels that apply. */
export function ConversationRow({
  conversation: c,
  active,
  onSelect,
  channelName,
  now,
  members,
  userId,
  actions,
  selection,
}: {
  conversation: InboxConversation;
  active: boolean;
  onSelect: () => void;
  /** "Quản lý" mode: a click ticks the row instead of opening it. */
  selection?: { checked: boolean; onToggle: () => void } | undefined;
  channelName?: string | undefined;
  now: number;
  members: readonly FilterMember[];
  userId: string;
  actions: RowActions;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  const [menuOpen, setMenuOpen] = useState(false);
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.${key}`);
  const v2 = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.v2.${key}`, options ?? {});
  const name = customerDisplayName(c, (provider, last4) => v2('row.guest', { provider, last4 }));
  const unread = c.unreadCount > 0;
  const assignee = c.assigneeId ? members.find((m) => m.userId === c.assigneeId) : undefined;
  // Done and Spam keep `awaitingSince` for a reopen, but nobody is waiting there.
  const minutes = c.status === 'open' ? waitMinutes(c.awaitingSince, now) : null;
  const wait = minutes === null ? null : compactWait(minutes);
  const urgent = minutes !== null && minutes > URGENT_WAIT_MINUTES;
  const prefix =
    c.lastMessageSender === 'human'
      ? v2('row.humanPrefix')
      : c.lastMessageSender === 'bot'
        ? v2('row.botPrefix')
        : '';
  return (
    <li className="group relative">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            ref={rowRef}
            type="button"
            onClick={selection ? selection.onToggle : onSelect}
            aria-current={active && !selection ? 'true' : undefined}
            aria-pressed={selection ? selection.checked : undefined}
            className={cn(
              'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60',
              active && !selection && 'bg-muted shadow-[inset_-3px_0_0_var(--primary)]',
              selection?.checked && 'bg-primary-soft/50',
            )}
          >
            {selection ? (
              // Visual only: the row button itself is the toggle (a nested button is invalid HTML).
              <span
                aria-hidden
                className={cn(
                  'mt-3 grid size-4 shrink-0 place-items-center rounded-[4px] border shadow-xs',
                  selection.checked && 'border-primary bg-primary text-primary-foreground',
                )}
              >
                {selection.checked ? <Check className="size-3.5" /> : null}
              </span>
            ) : null}
            <CustomerAvatar conversation={c} name={name}>
              {unread ? (
                <span
                  role="img"
                  aria-label={v2('row.unreadBadge', { count: c.unreadCount })}
                  className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full border-2 border-background bg-primary px-0.5 text-[10px] leading-3 font-semibold text-primary-foreground"
                >
                  {c.unreadCount > 99 ? '99+' : c.unreadCount}
                </span>
              ) : null}
            </CustomerAvatar>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                {c.assigneeId ? (
                  <span
                    role="img"
                    aria-label={v2('row.assignedTo', { name: assignee?.name ?? tr('assigned') })}
                    title={assignee?.name}
                    className="grid size-4 shrink-0 place-items-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground"
                  >
                    {assignee ? (Array.from(assignee.name.trim())[0] ?? '?').toUpperCase() : '·'}
                  </span>
                ) : null}
                <span className={cn('truncate text-sm', unread ? 'font-bold' : 'font-medium')}>
                  {name}
                </span>
                {hasNewLead(c) ? (
                  <span
                    title={v2('row.newLeadLabel')}
                    className="shrink-0 rounded-full bg-primary px-1.5 py-px text-[10px] leading-4 font-semibold text-primary-foreground"
                  >
                    {v2('row.newLead')}
                  </span>
                ) : null}
                {c.status === 'resolved' ? (
                  <CheckCheck
                    className="size-3.5 shrink-0 text-success"
                    aria-label={tr('resolved')}
                  />
                ) : c.status === 'spam' ? (
                  <OctagonAlert
                    className="size-3.5 shrink-0 text-destructive"
                    aria-label={t('channelInbox.meta.folder.spam')}
                  />
                ) : null}
                {c.starred ? (
                  <Star
                    className="size-3.5 shrink-0 fill-amber-400 text-amber-500"
                    role="img"
                    aria-label={t('channelInbox.meta.starred')}
                  />
                ) : null}
                <time
                  className="ml-auto shrink-0 text-[11px] text-muted-foreground transition-[margin] group-focus-within:mr-6 group-hover:mr-6 pointer-coarse:mr-6"
                  dateTime={c.updatedAt}
                >
                  {formatRowTime(c.updatedAt, now)}
                </time>
              </span>
              <span className="mt-0.5 flex items-center gap-2">
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-xs',
                    unread ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {prefix}
                  {previewText(c.lastMessage, tr)}
                </span>
                {wait ? (
                  <span
                    className={cn(
                      'flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums',
                      urgent ? 'font-semibold text-destructive' : 'text-muted-foreground',
                    )}
                    data-urgent={urgent ? 'true' : undefined}
                    aria-label={v2('row.waited', {
                      time: v2(`row.wait.${wait.unit}`, { n: wait.n }),
                    })}
                  >
                    <Clock className="size-3" aria-hidden />
                    {v2(`row.wait.${wait.unit}`, { n: wait.n })}
                  </span>
                ) : null}
              </span>
              <span className="mt-1 flex items-center gap-1">
                <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                  {c.tags.slice(0, MAX_TAGS).map((tag) => (
                    <TagChip key={tag.id} name={tag.name} color={tag.color} className="shrink" />
                  ))}
                  {c.tags.length > MAX_TAGS ? (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      +{c.tags.length - MAX_TAGS}
                    </span>
                  ) : null}
                  {c.tags.length ? null : (
                    <ChannelBadge provider={c.provider} title={channelName} />
                  )}
                </span>
                {c.customerPhone ? (
                  <Phone
                    className="size-3 shrink-0 text-muted-foreground"
                    role="img"
                    aria-label={v2('row.phone')}
                  />
                ) : null}
                {c.mode === 'bot' ? (
                  <Bot
                    className="size-3 shrink-0 text-primary"
                    role="img"
                    aria-label={v2('row.modeBot')}
                  />
                ) : (
                  <UserRound
                    className="size-3 shrink-0 text-muted-foreground"
                    role="img"
                    aria-label={v2('row.modeHuman')}
                  />
                )}
              </span>
            </span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <RowMenuItems
            kit={CONTEXT_KIT}
            conversation={c}
            unread={unread}
            members={members}
            userId={userId}
            actions={actions}
          />
        </ContextMenuContent>
      </ContextMenu>
      {selection ? null : (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={v2('row.menu')}
              className="absolute top-1.5 right-1.5 size-6 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <RowMenuItems
              kit={DROPDOWN_KIT}
              conversation={c}
              unread={unread}
              members={members}
              userId={userId}
              actions={actions}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

type MenuKit = {
  Item: typeof DropdownMenuItem | typeof ContextMenuItem;
  Sub: typeof DropdownMenuSub | typeof ContextMenuSub;
  SubTrigger: typeof DropdownMenuSubTrigger | typeof ContextMenuSubTrigger;
  SubContent: typeof DropdownMenuSubContent | typeof ContextMenuSubContent;
};
const DROPDOWN_KIT: MenuKit = {
  Item: DropdownMenuItem,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};
const CONTEXT_KIT: MenuKit = {
  Item: ContextMenuItem,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

/** The row actions, shared by the "⋯" button and the right-click menu. */
function RowMenuItems({
  kit: { Item, Sub, SubTrigger, SubContent },
  conversation: c,
  unread,
  members,
  userId,
  actions,
}: {
  kit: MenuKit;
  conversation: InboxConversation;
  unread: boolean;
  members: readonly FilterMember[];
  userId: string;
  actions: RowActions;
}) {
  const { t } = useTranslation();
  const v2 = (key: string) => t(`channelInbox.v2.${key}`);
  return (
    <>
      {unread ? (
        <Item onSelect={() => actions.onMarkRead(c.id)}>{v2('row.markRead')}</Item>
      ) : (
        <Item onSelect={() => actions.onMarkUnread(c.id)}>{v2('row.markUnread')}</Item>
      )}
      <Sub>
        <SubTrigger>{v2('row.assign')}</SubTrigger>
        <SubContent className="max-h-64 w-48 overflow-y-auto">
          {userId ? (
            <Item
              disabled={c.assigneeId === userId}
              onSelect={() => actions.onAssign(c.id, userId)}
            >
              {v2('row.assignMe')}
            </Item>
          ) : null}
          {members
            .filter((m) => m.userId !== userId)
            .map((member) => (
              <Item
                key={member.userId}
                disabled={c.assigneeId === member.userId}
                onSelect={() => actions.onAssign(c.id, member.userId)}
              >
                <span className="truncate">{member.name}</span>
              </Item>
            ))}
          <Item disabled={c.assigneeId === null} onSelect={() => actions.onAssign(c.id, null)}>
            {v2('row.unassign')}
          </Item>
        </SubContent>
      </Sub>
    </>
  );
}
