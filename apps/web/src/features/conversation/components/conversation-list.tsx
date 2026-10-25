import type { ChannelConnectionDto, ConversationDto } from '@agent-sales/contracts';
import type { RefObject } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowUpDown, CircleAlert, MessageCircle, RefreshCw, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { SALES_QUEUES, type ListState } from '../lib/inbox-list';
import { SavedInboxViews } from './saved-inbox-views';
import { ChannelFilter } from './channel-filter';
import { ConversationRow } from './conversation-row';
import { ListFilters } from './list-filters';

/** Left column of the inbox: "Chat" header, channel filter, search, sort and conversations. */
export function ConversationList({
  state,
  searchRef,
  workspaceId,
  userId,
  onState,
  items,
  channels,
  queueCounts,
  loadedCount,
  pending,
  error,
  fetching,
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
  items: readonly ConversationDto[];
  channels: readonly ChannelConnectionDto[];
  queueCounts: Record<string, number>;
  loadedCount: number;
  pending: boolean;
  error: boolean;
  fetching: boolean;
  onRefetch: () => void;
  hasChannel: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  hidden: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.${key}`, options ?? {});
  const orderLabel = tr(state.order === 'newest' ? 'inbox.sortNewest' : 'inbox.sortOldest');
  const filtered = Boolean(
    state.q ||
    state.provider !== 'all' ||
    state.mode !== 'all' ||
    state.channelId !== 'all' ||
    state.queue !== 'all' ||
    state.status !== 'open',
  );
  return (
    <aside
      className={cn(
        'flex min-h-0 w-full shrink-0 flex-col border-r bg-background md:w-72 2xl:w-80',
        hidden ? 'hidden md:flex' : 'flex',
      )}
    >
      <div className="space-y-3 border-b p-4">
        <h1 className="sr-only">{tr('inbox.pageTitle')}</h1>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-semibold tracking-tight">{tr('inbox.title')}</h2>
          <ChannelFilter
            value={state.provider}
            onChange={(provider) => onState({ provider, channelId: 'all' })}
          />
        </div>
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label={tr('sales.queues')}>
          {SALES_QUEUES.map((queue) => (
            <Button
              key={queue}
              variant={state.queue === queue ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(
                'justify-between px-2.5 text-xs',
                state.queue === queue && 'text-primary',
              )}
              aria-pressed={state.queue === queue}
              onClick={() => onState({ queue })}
            >
              <span>{tr(`sales.queue.${queue}`)}</span>
              <span className="rounded-md bg-muted px-1.5 py-0.5 tabular-nums text-muted-foreground">
                {pending || error ? '—' : queueCounts[queue]}
              </span>
            </Button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden />
          <Input
            ref={searchRef}
            type="search"
            aria-label={tr('inbox.searchPlaceholder')}
            placeholder={tr('inbox.searchPlaceholder')}
            value={state.q}
            onChange={(event) => onState({ q: event.target.value })}
            className="pl-9"
          />
        </div>
        <Select value={state.channelId} onValueChange={(channelId) => onState({ channelId })}>
          <SelectTrigger className="w-full text-xs" aria-label={tr('sales.pageFilter')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tr('sales.allPages')}</SelectItem>
            {channels
              .filter((channel) => state.provider === 'all' || channel.provider === state.provider)
              .map((channel) => (
                <SelectItem key={channel.id} value={channel.id}>
                  {channel.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <SavedInboxViews
          workspaceId={workspaceId}
          userId={userId}
          state={state}
          onApply={onState}
        />
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2"
            aria-label={tr('inbox.sortLabel', { order: orderLabel })}
            onClick={() => onState({ order: state.order === 'newest' ? 'oldest' : 'newest' })}
          >
            {orderLabel}
            <ArrowUpDown />
          </Button>
          <div className="flex items-center">
            <ListFilters
              status={state.status}
              mode={state.mode}
              onStatus={(status) => onState({ status })}
              onMode={(mode) => onState({ mode })}
            />
            <Button variant="ghost" size="icon" aria-label={tr('refresh')} onClick={onRefetch}>
              <RefreshCw className={fetching ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-b bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
        <span>{tr('sales.loadedScope', { count: loadedCount })}</span>
        {filtered ? (
          <button
            type="button"
            className="shrink-0 font-medium text-primary hover:underline"
            onClick={() =>
              onState({
                q: '',
                provider: 'all',
                channelId: 'all',
                status: 'open',
                mode: 'all',
                queue: 'all',
              })
            }
          >
            {tr('sales.clearFilters')}
          </button>
        ) : null}
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
            <h3 className="text-sm font-semibold">{tr(filtered ? 'emptyFilter' : 'emptyInbox')}</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {tr('emptyInboxBody')}
            </p>
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
