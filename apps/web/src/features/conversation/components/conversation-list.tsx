import type { ConversationDto, MetaProvider } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { ArrowUpDown, CircleAlert, MessageCircle, RefreshCw, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { SortOrder } from '../lib/inbox-list';
import { ChannelFilter } from './channel-filter';
import { ConversationRow } from './conversation-row';
import { ListFilters, type ModeFilter, type StatusFilter } from './list-filters';

export interface ListState {
  q: string;
  provider: MetaProvider | 'all';
  status: StatusFilter;
  mode: ModeFilter;
  order: SortOrder;
}

/** Left column of the inbox: "Chat" header, channel filter, search, sort and conversations. */
export function ConversationList({
  state,
  onState,
  items,
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
  onState: (patch: Partial<ListState>) => void;
  items: readonly ConversationDto[];
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
  const filtered = Boolean(state.q || state.provider !== 'all' || state.mode !== 'all');
  return (
    <aside
      className={cn(
        'flex w-full shrink-0 flex-col border-r bg-background md:w-80',
        hidden ? 'hidden md:flex' : 'flex',
      )}
    >
      <div className="space-y-3 border-b p-4">
        <h1 className="sr-only">{tr('inbox.pageTitle')}</h1>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">{tr('inbox.title')}</h2>
          <ChannelFilter value={state.provider} onChange={(provider) => onState({ provider })} />
        </div>
        <div className="relative">
          <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label={tr('inbox.searchPlaceholder')}
            placeholder={tr('inbox.searchPlaceholder')}
            value={state.q}
            onChange={(event) => onState({ q: event.target.value })}
            className="pl-9"
          />
        </div>
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
      <div className="flex-1 overflow-y-auto">
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
    </aside>
  );
}
