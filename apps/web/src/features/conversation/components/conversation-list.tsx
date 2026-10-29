import type { ChannelConnectionDto } from '@agent-sales/contracts';
import type { RefObject } from 'react';
import { Link } from '@tanstack/react-router';
import { CircleAlert, Layers, MessageCircle, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { DEFAULT_LIST_STATE, filterChips, isFiltered, type ListState } from '../lib/inbox-list';
import type { InboxConversation, InboxCounts } from '../lib/inbox-v2-types';
import { BulkBar, type BulkRun } from './bulk-bar';
import { ConversationRow, type RowActions } from './conversation-row';
import { EnableNotificationsButton } from './enable-notifications-button';
import { InboxFilterChips } from './inbox-filter-chips';
import {
  InboxFilterPopover,
  type FilterBot,
  type FilterMember,
  type FilterTag,
} from './inbox-filter-popover';

/** "Quản lý" mode state, owned by the page so a filter change can clear it. */
export interface ListSelection {
  ids: ReadonlySet<string>;
  busy: boolean;
  onToggle: (id: string) => void;
  onSelectAll: (all: boolean) => void;
  onRun: (run: BulkRun) => void;
  onCancel: () => void;
}

/** One quick filter of Meta's row: applies at once, pressed while on. */
function QuickFilter({
  pressed,
  onClick,
  label,
  count,
}: {
  pressed: boolean;
  onClick: () => void;
  label: string;
  count?: number | undefined;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] whitespace-nowrap text-foreground/80 hover:bg-muted',
        pressed && 'bg-primary-soft font-medium text-primary hover:bg-primary-soft',
      )}
    >
      {label}
      {count !== undefined ? (
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      ) : null}
    </button>
  );
}

/** Left column: search and "Quản lý", quick filters, active filter chips, conversations. */
export function ConversationList({
  state,
  searchRef,
  userId,
  onState,
  items,
  channels,
  tags,
  members,
  bots,
  counts,
  pending,
  error,
  onRefetch,
  hasChannel,
  selected,
  onSelect,
  hidden,
  now,
  actions,
  managing,
  onManage,
  selection,
  refreshing = false,
}: {
  state: ListState;
  searchRef: RefObject<HTMLInputElement | null>;
  userId: string;
  onState: (patch: Partial<ListState>) => void;
  items: readonly InboxConversation[];
  channels: readonly ChannelConnectionDto[];
  tags: readonly FilterTag[];
  members: readonly FilterMember[];
  bots: readonly FilterBot[];
  counts: InboxCounts;
  pending: boolean;
  error: boolean;
  onRefetch: () => void;
  hasChannel: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  hidden: boolean;
  now: number;
  actions: RowActions;
  managing: boolean;
  onManage: () => void;
  selection: ListSelection;
  /** Previous rows shown while new filters load: their counts would be wrong to announce. */
  refreshing?: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.${key}`, options ?? {});
  const meta = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.meta.${key}`, options ?? {});
  const filtered = isFiltered(state);
  const quiet = !filterChips(state).length && !state.q && !state.starred && !state.followUp;
  const emptyKey =
    state.tab === 'unread' && quiet
      ? 'v2.list.emptyUnread'
      : state.tab === 'waiting' && quiet
        ? 'v2.list.emptyWaiting'
        : filtered
          ? 'emptyFilter'
          : 'emptyInbox';
  const count = (n: number) => (pending || error ? undefined : n);
  const pageChannels = channels.filter(
    (channel) => state.provider === 'all' || channel.provider === state.provider,
  );
  return (
    <aside
      className={cn(
        'flex min-h-0 w-full shrink-0 flex-col border-r bg-background md:w-[340px] 2xl:w-96',
        hidden ? 'hidden md:flex' : 'flex',
      )}
    >
      <div className="space-y-2 p-3 pb-2">
        <h1 className="sr-only">{tr('inbox.pageTitle')}</h1>
        <EnableNotificationsButton />
        <div className="flex items-center gap-2">
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
          <Button
            variant={managing ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={managing}
            onClick={onManage}
          >
            <Layers />
            {meta('manage')}
          </Button>
        </div>
        <div className="flex items-start gap-1">
          <div
            role="group"
            aria-label={meta('quick.label')}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5"
          >
            <QuickFilter
              pressed={state.tab === 'unread'}
              onClick={() => onState({ tab: state.tab === 'unread' ? 'all' : 'unread' })}
              label={meta('quick.unread')}
              count={count(counts.unread)}
            />
            <QuickFilter
              pressed={state.tab === 'waiting'}
              onClick={() => onState({ tab: state.tab === 'waiting' ? 'all' : 'waiting' })}
              label={meta('quick.waiting')}
              count={count(counts.waiting)}
            />
            <QuickFilter
              pressed={state.starred}
              onClick={() => onState({ starred: !state.starred })}
              label={meta('quick.starred')}
            />
            <QuickFilter
              pressed={state.followUp}
              onClick={() => onState({ followUp: !state.followUp })}
              label={meta('quick.followUp')}
            />
          </div>
          <InboxFilterPopover
            state={state}
            onState={onState}
            tags={tags}
            members={members}
            channels={pageChannels}
            bots={bots}
          />
        </div>
        {state.status !== 'open' ? (
          <p
            role="status"
            className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1 text-xs"
          >
            <span>{meta('folder.viewing', { folder: meta(`folder.${state.status}`) })}</span>
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => onState({ status: 'open' })}
            >
              {meta('folder.back')}
            </button>
          </p>
        ) : null}
        <InboxFilterChips
          state={state}
          onState={onState}
          tags={tags}
          members={members}
          channels={channels.map((c) => ({ id: c.id, name: c.name, provider: c.provider }))}
          bots={bots}
        />
        {!pending && !error && !refreshing ? (
          <p className="sr-only" aria-live="polite">
            {meta('total', {
              count:
                state.tab === 'unread'
                  ? counts.unread
                  : state.tab === 'waiting'
                    ? counts.waiting
                    : counts.all,
            })}
          </p>
        ) : null}
      </div>
      {managing ? (
        <BulkBar
          visible={items.length}
          selected={selection.ids.size}
          folder={state.status}
          members={members}
          userId={userId}
          busy={selection.busy}
          onSelectAll={selection.onSelectAll}
          onRun={selection.onRun}
          onCancel={selection.onCancel}
        />
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto border-t">
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
          <ul>
            {items.map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                active={selected === c.id}
                onSelect={() => onSelect(c.id)}
                channelName={channels.find((channel) => channel.id === c.channelId)?.name}
                now={now}
                members={members}
                userId={userId}
                actions={actions}
                selection={
                  managing
                    ? { checked: selection.ids.has(c.id), onToggle: () => selection.onToggle(c.id) }
                    : undefined
                }
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
                // Clearing filters keeps the channel tab: it is navigation, not a filter.
                onClick={() => onState({ ...DEFAULT_LIST_STATE, provider: state.provider })}
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
