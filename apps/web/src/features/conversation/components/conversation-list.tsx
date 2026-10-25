import type { ChannelConnectionDto } from '@agent-sales/contracts';
import type { RefObject } from 'react';
import { Link } from '@tanstack/react-router';
import { CircleAlert, MessageCircle, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { DEFAULT_LIST_STATE, filterChips, isFiltered, type ListState } from '../lib/inbox-list';
import type { InboxConversation, InboxCounts, InboxTab } from '../lib/inbox-v2-types';
import { ConversationRow } from './conversation-row';
import { InboxFilterChips } from './inbox-filter-chips';
import { InboxFilterPopover, type FilterMember, type FilterTag } from './inbox-filter-popover';
import { SavedInboxViews } from './saved-inbox-views';

const TABS: readonly InboxTab[] = ['all', 'unread', 'waiting'];

/** Left column of the inbox: search, filter, tabs with counts, chips and conversations. */
export function ConversationList({
  state,
  searchRef,
  workspaceId,
  userId,
  onState,
  items,
  channels,
  tags,
  members,
  counts,
  pending,
  error,
  onRefetch,
  hasChannel,
  selected,
  onSelect,
  hidden,
}: {
  state: ListState;
  searchRef: RefObject<HTMLInputElement | null>;
  workspaceId: string;
  userId: string;
  onState: (patch: Partial<ListState>) => void;
  items: readonly InboxConversation[];
  channels: readonly ChannelConnectionDto[];
  tags: readonly FilterTag[];
  members: readonly FilterMember[];
  counts: InboxCounts;
  pending: boolean;
  error: boolean;
  onRefetch: () => void;
  hasChannel: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  hidden: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.${key}`, options ?? {});
  const filtered = isFiltered(state);
  const emptyKey =
    state.tab === 'unread' && !filterChips(state).length && !state.q
      ? 'v2.list.emptyUnread'
      : state.tab === 'waiting' && !filterChips(state).length && !state.q
        ? 'v2.list.emptyWaiting'
        : filtered
          ? 'emptyFilter'
          : 'emptyInbox';
  return (
    <aside
      className={cn(
        'flex min-h-0 w-full shrink-0 flex-col border-r bg-background md:w-80 2xl:w-96',
        hidden ? 'hidden md:flex' : 'flex',
      )}
    >
      <div className="space-y-2 border-b p-3">
        <h1 className="sr-only">{tr('inbox.pageTitle')}</h1>
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute top-2 left-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input
              ref={searchRef}
              type="search"
              aria-label={tr('v2.list.search')}
              placeholder={tr('v2.list.search')}
              value={state.q}
              onChange={(event) => onState({ q: event.target.value })}
              className="h-8 pl-8"
            />
          </div>
          <SavedInboxViews
            workspaceId={workspaceId}
            userId={userId}
            state={state}
            onApply={onState}
          />
          <InboxFilterPopover
            state={state}
            onState={onState}
            tags={tags}
            members={members}
            channels={channels}
          />
        </div>
        <div
          role="tablist"
          aria-label={tr('v2.list.tabsLabel')}
          className="flex items-center gap-1 text-xs"
        >
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={state.tab === tab}
              onClick={() => onState({ tab })}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-muted-foreground hover:bg-muted',
                state.tab === tab && 'bg-primary-soft text-primary',
              )}
            >
              {tr(`v2.list.tabs.${tab}`)}
              <span className="tabular-nums">{pending || error ? '—' : counts[tab]}</span>
            </button>
          ))}
        </div>
        <InboxFilterChips
          state={state}
          onState={onState}
          tags={tags}
          members={members}
          channels={channels.map((c) => ({ id: c.id, name: c.name, provider: c.provider }))}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {pending ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-16" />
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="p-5 text-center text-sm">
            <CircleAlert className="mx-auto mb-2 size-6 text-destructive" />
            <p>{tr('loadError')}</p>
            <Button className="mt-3" variant="outline" onClick={onRefetch}>
              {tr('retry')}
            </Button>
          </div>
        ) : items.length ? (
          <ul className="divide-y">
            {items.map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                active={selected === c.id}
                onSelect={() => onSelect(c.id)}
                channelName={channels.find((channel) => channel.id === c.channelId)?.name}
              />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center px-5 py-12 text-center">
            <MessageCircle className="mb-3 size-9 text-muted-foreground" aria-hidden />
            <h3 className="text-sm font-semibold">{tr(emptyKey)}</h3>
            {emptyKey === 'emptyInbox' ? (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {tr('emptyInboxBody')}
              </p>
            ) : null}
            {filtered ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => onState({ ...DEFAULT_LIST_STATE })}
              >
                {tr('v2.list.clearAll')}
              </Button>
            ) : null}
            {!hasChannel ? (
              <Button variant="outline" className="mt-4" asChild>
                <Link to="/app/channels">{tr('connect')}</Link>
              </Button>
            ) : null}
          </div>
        )}
      </div>
      <p className="hidden shrink-0 border-t px-3 py-2 text-[10px] text-muted-foreground md:block">
        {tr('sales.shortcutsHint')}
      </p>
    </aside>
  );
}
