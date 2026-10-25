import { useRef, useState, type ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { useWorkspaceId } from '@/lib/use-workspace';
import { useInboxShortcuts } from '../hooks/use-inbox-shortcuts';
import { useInbox, useInboxChannels, useInboxMembers, useInboxTags } from '../api/inbox';
import {
  DEFAULT_LIST_STATE,
  guardList,
  tabCounts,
  toListQuery,
  type ListState,
} from '../lib/inbox-list';
import type { InboxConversation } from '../lib/inbox-v2-types';
import { ConversationList } from './conversation-list';
import { ConversationView } from './conversation-view';
import { InboxEmptyState } from './inbox-empty-state';

export function InboxPage({
  renderSalesPanel,
  renderComposerTools,
}: {
  renderSalesPanel?: ((conversation: InboxConversation) => ReactNode) | undefined;
  renderComposerTools?:
    | ((conversation: InboxConversation, insertText: (text: string) => void) => ReactNode)
    | undefined;
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
  renderSalesPanel?: ((conversation: InboxConversation) => ReactNode) | undefined;
  renderComposerTools?:
    | ((conversation: InboxConversation, insertText: (text: string) => void) => ReactNode)
    | undefined;
}) {
  const userId = useSession()?.user.id;
  const workspaceId = useWorkspaceId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<{ id: string; channelId: string } | null>(null);
  const [state, setState] = useState<ListState>(DEFAULT_LIST_STATE);
  const inbox = useInbox(toListQuery(state));
  const channels = useInboxChannels();
  const tags = useInboxTags();
  const members = useInboxMembers();
  const items = guardList(inbox.data?.data ?? [], state, userId);
  const counts = tabCounts(inbox.data?.data ?? [], inbox.data?.counts);
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
        tags={tags.data ?? []}
        members={members.data ?? []}
        counts={counts}
        pending={inbox.isPending}
        error={inbox.isError}
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
