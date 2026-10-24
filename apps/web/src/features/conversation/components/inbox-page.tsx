import { useState } from 'react';
import { useInbox, useInboxChannels } from '../api/inbox';
import { filterByProvider, sortConversations } from '../lib/inbox-list';
import { ConversationList, type ListState } from './conversation-list';
import { ConversationView } from './conversation-view';
import { InboxEmptyState } from './inbox-empty-state';

/** Multichannel inbox (Preny "Tin nhắn đa kênh"): conversation list + open conversation. */
export function InboxPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setState] = useState<ListState>({
    q: '',
    provider: 'all',
    status: 'open',
    mode: 'all',
    order: 'newest',
  });
  const { q, provider, status, mode, order } = state;
  const inbox = useInbox({
    q,
    ...(provider !== 'all' ? { provider } : {}),
    ...(status !== 'all' ? { status } : {}),
    ...(mode !== 'all' ? { mode } : {}),
    limit: 100,
  });
  const channels = useInboxChannels();
  const items = sortConversations(filterByProvider(inbox.data?.data ?? [], provider), order);
  const channelId = inbox.data?.data.find((item) => item.id === selected)?.channelId;
  const botId = channels.data?.data.find((c) => c.id === channelId)?.botId ?? null;
  return (
    <section
      data-content-padding="false"
      className="flex min-h-[calc(100svh-3.25rem)] w-full min-w-0 flex-1 overflow-hidden bg-background lg:h-[calc(100svh-3.25rem)]"
    >
      <ConversationList
        state={state}
        onState={(patch) => setState((prev) => ({ ...prev, ...patch }))}
        items={items}
        pending={inbox.isPending}
        error={inbox.isError}
        fetching={inbox.isFetching}
        onRefetch={() => void inbox.refetch()}
        hasChannel={Boolean(channels.data?.data.some((c) => c.status === 'connected'))}
        selected={selected}
        onSelect={setSelected}
        hidden={Boolean(selected)}
      />
      {selected ? (
        <ConversationView
          key={selected}
          id={selected}
          onBack={() => setSelected(null)}
          botId={botId}
        />
      ) : (
        <InboxEmptyState />
      )}
    </section>
  );
}
