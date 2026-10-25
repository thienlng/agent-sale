import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSession } from '@/lib/session';
import { useWorkspaceId } from '@/lib/use-workspace';
import { useDebouncedValue } from '../hooks/use-debounced-value';
import { markUnreadGuarded } from '../hooks/use-read-on-open';
import { useInboxShortcuts } from '../hooks/use-inbox-shortcuts';
import {
  useAssignConversation,
  useInbox,
  useInboxChannels,
  useInboxMembers,
  useInboxTags,
  useReadState,
} from '../api/inbox';
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
  const { t } = useTranslation();
  // Wait times and row times advance without a network update.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const { markRead, markUnread } = useReadState();
  const assign = useAssignConversation();
  const fail = () => toast.error(t('channelInbox.v2.row.actionError'));
  const actions = {
    onMarkUnread: (id: string) => void markUnreadGuarded(id, markUnread.mutateAsync).catch(fail),
    onMarkRead: (id: string) => markRead.mutate(id, { onError: fail }),
    onAssign: (id: string, assigneeId: string | null) =>
      assign.mutate({ id, assigneeId }, { onError: fail }),
  };
  const [selected, setSelected] = useState<{ id: string; channelId: string } | null>(null);
  const [state, setState] = useState<ListState>(DEFAULT_LIST_STATE);
  // The server is asked once typing pauses; the other filters apply at once.
  const debouncedQ = useDebouncedValue(state.q, 250);
  const inbox = useInbox(toListQuery({ ...state, q: debouncedQ }));
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
  const channel = channels.data?.data.find((c) => c.id === selected?.channelId);
  const botId = channel?.botId ?? null;
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
        now={now}
        actions={actions}
      />
      {selected ? (
        <ConversationView
          key={selected.id}
          id={selected.id}
          onBack={() => setSelected(null)}
          botId={botId}
          channel={channel ? { name: channel.name, externalId: channel.externalId } : undefined}
          renderSalesPanel={renderSalesPanel}
          renderComposerTools={renderComposerTools}
        />
      ) : (
        <InboxEmptyState />
      )}
    </section>
  );
}
