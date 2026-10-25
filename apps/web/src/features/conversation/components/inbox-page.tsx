import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ConversationDto } from '@agent-sales/contracts';
import { useSession } from '@/lib/session';
import { useWorkspaceId } from '@/lib/use-workspace';
import { useInboxShortcuts } from '../hooks/use-inbox-shortcuts';
import { useInbox, useInboxChannels } from '../api/inbox';
import {
  filterInbox,
  filterSalesQueue,
  SALES_QUEUES,
  sortConversations,
  type ListState,
} from '../lib/inbox-list';
import { ConversationList } from './conversation-list';
import { ConversationView } from './conversation-view';
import { InboxEmptyState } from './inbox-empty-state';

export function InboxPage({
  renderSalesPanel,
  renderComposerTools,
}: {
  renderSalesPanel?: ((conversation: ConversationDto) => ReactNode) | undefined;
  renderComposerTools?:
    ((conversation: ConversationDto, insertText: (text: string) => void) => ReactNode) | undefined;
}) {
  const workspaceId = useWorkspaceId();
  const userId = useSession()?.user.id ?? '';
  return (
    <InboxWorkspace
      key={`${workspaceId}:${userId}`}
      renderSalesPanel={renderSalesPanel}
      renderComposerTools={renderComposerTools}
    />
  );
}

function InboxWorkspace({
  renderSalesPanel,
  renderComposerTools,
}: {
  renderSalesPanel?: ((conversation: ConversationDto) => ReactNode) | undefined;
  renderComposerTools?:
    ((conversation: ConversationDto, insertText: (text: string) => void) => ReactNode) | undefined;
}) {
  const userId = useSession()?.user.id;
  const workspaceId = useWorkspaceId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const [selected, setSelected] = useState<{ id: string; channelId: string } | null>(null);
  const [state, setState] = useState<ListState>({
    q: '',
    provider: 'all',
    channelId: 'all',
    status: 'open',
    mode: 'all',
    order: 'newest',
    queue: 'all',
  });
  // Fetch a bounded shared set so queue counts remain comparable when switching queues.
  const inbox = useInbox({ q: state.q, limit: 100 });
  const channels = useInboxChannels();
  const filtered = filterInbox(inbox.data?.data ?? [], state);
  const items = sortConversations(
    filterSalesQueue(filtered, state.queue, userId, now),
    state.order,
  );
  const queueCounts = Object.fromEntries(
    SALES_QUEUES.map((queue) => [queue, filterSalesQueue(filtered, queue, userId, now).length]),
  );
  function selectConversation(id: string) {
    const item = items.find((conversation) => conversation.id === id);
    if (item) setSelected({ id, channelId: item.channelId });
  }
  useInboxShortcuts({
    ids: items.map((conversation) => conversation.id),
    selected: selected?.id ?? null,
    onSelect: selectConversation,
    onSearch: () => {
      if (window.matchMedia('(max-width: 767px)').matches) setSelected(null);
      window.requestAnimationFrame(() => searchRef.current?.focus());
    },
  });
  const botId = channels.data?.data.find((c) => c.id === selected?.channelId)?.botId ?? null;
  return (
    <section
      data-content-padding="false"
      className="flex h-[calc(100svh-3.25rem)] w-full min-w-0 overflow-hidden bg-background"
    >
      <ConversationList
        state={state}
        searchRef={searchRef}
        workspaceId={workspaceId}
        userId={userId ?? ''}
        onState={(patch) => setState((prev) => ({ ...prev, ...patch }))}
        items={items}
        channels={channels.data?.data ?? []}
        queueCounts={queueCounts}
        loadedCount={inbox.data?.data.length ?? 0}
        pending={inbox.isPending}
        error={inbox.isError}
        fetching={inbox.isFetching}
        onRefetch={() => void inbox.refetch()}
        hasChannel={Boolean(channels.data?.data.some((c) => c.status === 'connected'))}
        selected={selected?.id ?? null}
        onSelect={selectConversation}
        hidden={Boolean(selected)}
      />
      {selected ? (
        <ConversationView
          key={selected.id}
          id={selected.id}
          onBack={() => setSelected(null)}
          botId={botId}
          renderSalesPanel={renderSalesPanel}
          renderComposerTools={renderComposerTools}
        />
      ) : (
        <InboxEmptyState />
      )}
    </section>
  );
}
