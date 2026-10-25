import { useState, type ReactNode } from 'react';
import type { ConversationDto } from '@agent-sales/contracts';
import { useSession } from '@/lib/session';
import { useWorkspaceId } from '@/lib/use-workspace';
import { useInbox, useInboxChannels } from '../api/inbox';
import { filterInbox, filterSalesQueue, SALES_QUEUES, sortConversations } from '../lib/inbox-list';
import { ConversationList, type ListState } from './conversation-list';
import { ConversationView } from './conversation-view';
import { InboxEmptyState } from './inbox-empty-state';

export function InboxPage({
  renderSalesPanel,
}: {
  renderSalesPanel?: ((conversation: ConversationDto) => ReactNode) | undefined;
}) {
  const workspaceId = useWorkspaceId();
  return <InboxWorkspace key={workspaceId} renderSalesPanel={renderSalesPanel} />;
}

function InboxWorkspace({
  renderSalesPanel,
}: {
  renderSalesPanel?: ((conversation: ConversationDto) => ReactNode) | undefined;
}) {
  const userId = useSession()?.user.id;
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
  const items = sortConversations(filterSalesQueue(filtered, state.queue, userId), state.order);
  const queueCounts = Object.fromEntries(
    SALES_QUEUES.map((queue) => [queue, filterSalesQueue(filtered, queue, userId).length]),
  );
  const botId = channels.data?.data.find((c) => c.id === selected?.channelId)?.botId ?? null;
  return (
    <section
      data-content-padding="false"
      className="flex h-[calc(100svh-3.25rem)] w-full min-w-0 overflow-hidden bg-background"
    >
      <ConversationList
        state={state}
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
        onSelect={(id) => {
          const item = items.find((c) => c.id === id);
          if (item) setSelected({ id, channelId: item.channelId });
        }}
        hidden={Boolean(selected)}
      />
      {selected ? (
        <ConversationView
          key={selected.id}
          id={selected.id}
          onBack={() => setSelected(null)}
          botId={botId}
          renderSalesPanel={renderSalesPanel}
        />
      ) : (
        <InboxEmptyState />
      )}
    </section>
  );
}
