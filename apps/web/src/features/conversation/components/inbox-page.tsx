import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ChartColumn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/session';
import { useWorkspaceId } from '@/lib/use-workspace';
import { cn } from '@/lib/utils';
import { useDebouncedValue } from '../hooks/use-debounced-value';
import { markUnreadGuarded } from '../hooks/use-read-on-open';
import { useInboxShortcuts } from '../hooks/use-inbox-shortcuts';
import { useLeadAlerts } from '../hooks/use-lead-alerts';
import {
  useAssignConversation,
  useBulkConversations,
  useConversation,
  useInbox,
  useInboxChannels,
  useInboxBots,
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
import type { BulkRun } from './bulk-bar';
import { ChannelTabs, type InboxSection } from './channel-tabs';
import { CommentsEntry } from './comments-entry';
import { ConversationList } from './conversation-list';
import { ConversationView, type PanelSlots } from './conversation-view';
import { Hint } from './hint';
import { InboxEmptyState } from './inbox-empty-state';

type SalesPanel = (conversation: InboxConversation, slots: PanelSlots) => ReactNode;
type ComposerTools = (
  conversation: InboxConversation,
  insertText: (text: string) => void,
) => ReactNode;

export function InboxPage({
  renderSalesPanel,
  renderComposerTools,
  renderComments,
  openConversationId,
}: {
  renderSalesPanel?: SalesPanel | undefined;
  renderComposerTools?: ComposerTools | undefined;
  /** The Facebook comments workspace, owned by the channel feature (composed by the route). */
  renderComments?: (() => ReactNode) | undefined;
  /** Deep link (`/app/inbox?conversation=`): opened once, even when the list does not show it. */
  openConversationId?: string | undefined;
}) {
  const workspaceId = useWorkspaceId();
  const userId = useSession()?.user.id ?? '';
  return (
    <InboxWorkspace
      key={`${workspaceId}:${userId}`}
      renderSalesPanel={renderSalesPanel}
      renderComposerTools={renderComposerTools}
      renderComments={renderComments}
      openConversationId={openConversationId}
    />
  );
}

/** Ids that failed in the last bulk run, kept selected so "retry" only repeats those. */
function failedIds(data: readonly { id: string; ok: boolean }[]): Set<string> {
  return new Set(data.filter((r) => !r.ok).map((r) => r.id));
}

function InboxWorkspace({
  renderSalesPanel,
  renderComposerTools,
  renderComments,
  openConversationId,
}: {
  renderSalesPanel?: SalesPanel | undefined;
  renderComposerTools?: ComposerTools | undefined;
  renderComments?: (() => ReactNode) | undefined;
  openConversationId?: string | undefined;
}) {
  const userId = useSession()?.user.id;
  const searchRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  const meta = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.meta.${key}`, options ?? {});
  // Wait times and row times advance without a network update.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const { markRead, markUnread } = useReadState();
  const assign = useAssignConversation();
  const bulk = useBulkConversations();
  const fail = () => toast.error(t('channelInbox.v2.row.actionError'));
  const actions = {
    onMarkUnread: (id: string) => void markUnreadGuarded(id, markUnread.mutateAsync).catch(fail),
    onMarkRead: (id: string) => markRead.mutate(id, { onError: fail }),
    onAssign: (id: string, assigneeId: string | null) =>
      assign.mutate({ id, assigneeId }, { onError: fail }),
  };
  const [selected, setSelected] = useState<{ id: string; channelId: string } | null>(null);
  // The deep-linked conversation is looked up by id once; closing it afterwards stays closed.
  const [deepLink, setDeepLink] = useState(openConversationId);
  const linked = useConversation(deepLink ?? null).data?.conversation;
  useEffect(() => {
    if (!linked) return;
    setSelected({ id: linked.id, channelId: linked.channelId });
    setDeepLink(undefined);
  }, [linked]);
  const [state, setState] = useState<ListState>(DEFAULT_LIST_STATE);
  const [comments, setComments] = useState(false);
  const [managing, setManaging] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null);
  const [panelOpen, setPanelOpen] = useState(
    () =>
      typeof window.matchMedia === 'function' && window.matchMedia('(min-width:1280px)').matches,
  );
  // The server is asked once typing pauses; the other filters apply at once.
  const debouncedQ = useDebouncedValue(state.q, 250);
  const listQuery = toListQuery({ ...state, q: debouncedQ });
  const inbox = useInbox(listQuery);
  // While the previous rows are kept for a new query they are not that query's rows: wait for them.
  useLeadAlerts(inbox.isPlaceholderData ? undefined : inbox.data?.data, JSON.stringify(listQuery));
  const channels = useInboxChannels();
  const tags = useInboxTags();
  const members = useInboxMembers();
  const bots = useInboxBots();
  const items = guardList(inbox.data?.data ?? [], state, userId);
  const counts = tabCounts(inbox.data?.data ?? [], inbox.data?.counts);
  const section: InboxSection = comments ? 'fbComments' : state.provider;
  // Rows can leave the list (a refetch, another agent): only visible ticked rows count or act.
  const visibleChecked = new Set(items.filter((c) => checked.has(c.id)).map((c) => c.id));

  /** Any change of what the list shows drops the selection: it only ever covers visible rows. */
  function changeList(patch: Partial<ListState>) {
    if (checked.size) toast.info(meta('bulk.cleared'));
    setChecked(new Set());
    setState((previous) => ({ ...previous, ...patch }));
  }
  function changeSection(next: InboxSection) {
    setComments(next === 'fbComments');
    if (next === 'fbComments') {
      setManaging(false);
      setChecked(new Set());
      setSelected(null);
      return;
    }
    const page = channels.data?.data.find((channel) => channel.id === state.channelId);
    const open = channels.data?.data.find((channel) => channel.id === selected?.channelId);
    // The open conversation belongs to the other provider: it is not in this tab's list.
    if (open && next !== 'all' && open.provider !== next) setSelected(null);
    // A page of the other provider cannot stay selected under this tab.
    changeList({
      provider: next,
      ...(page && next !== 'all' && page.provider !== next ? { channelId: 'all' } : {}),
    });
  }
  function selectConversation(id: string) {
    const item = items.find((conversation) => conversation.id === id);
    if (item) setSelected({ id, channelId: item.channelId });
  }
  function runBulk(run: BulkRun, ids: readonly string[]) {
    if (!ids.length || bulk.isPending) return;
    bulk.mutate(
      {
        action: run.action,
        ids: [...ids],
        ...(run.action === 'assign' ? { assigneeId: run.assigneeId ?? null } : {}),
      },
      {
        onSuccess: (result) => {
          if (!result.failed) {
            toast.success(meta('bulk.done', { count: result.succeeded }));
            setChecked(new Set());
            return;
          }
          const retry = failedIds(result.data);
          setChecked(retry);
          toast.error(meta('bulk.partial', { ok: result.succeeded, failed: result.failed }), {
            action: { label: meta('bulk.retry'), onClick: () => runBulk(run, [...retry]) },
          });
        },
        onError: fail,
      },
    );
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
  const showPanel = Boolean(selected) && panelOpen && !comments;
  const botId = channel?.botId ?? null;
  const list = (
    <ConversationList
      state={state}
      searchRef={searchRef}
      userId={userId ?? ''}
      onState={changeList}
      items={items}
      channels={channels.data?.data ?? []}
      tags={tags.data ?? []}
      members={members.data ?? []}
      bots={bots.data ?? []}
      counts={counts}
      pending={inbox.isPending}
      refreshing={inbox.isPlaceholderData}
      error={inbox.isError}
      onRefetch={() => void inbox.refetch()}
      hasChannel={Boolean(channels.data?.data.some((c) => c.status === 'connected'))}
      selected={selected?.id ?? null}
      onSelect={selectConversation}
      hidden={Boolean(selected)}
      now={now}
      actions={actions}
      managing={managing}
      onManage={() => {
        setManaging((on) => !on);
        setChecked(new Set());
      }}
      selection={{
        ids: visibleChecked,
        busy: bulk.isPending,
        onToggle: (id) =>
          setChecked((previous) => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          }),
        onSelectAll: (all) => setChecked(all ? new Set(items.map((c) => c.id)) : new Set()),
        onRun: (run) => runBulk(run, [...visibleChecked]),
        onCancel: () => {
          setManaging(false);
          setChecked(new Set());
        },
      }}
    />
  );
  return (
    <section
      data-content-padding="false"
      // Fixed to the viewport (minus the top bar) at every width: `flex-1` would override the height and
      // let a long thread stretch the whole page.
      className="flex h-[calc(100svh-3.25rem)] w-full min-w-0 flex-col overflow-hidden bg-muted/40 md:gap-2 md:p-2"
    >
      <header className="hidden shrink-0 items-center gap-3 px-1 md:flex">
        <h2 className="text-lg font-semibold">{meta('title')}</h2>
        <div className="ml-auto flex items-center gap-1.5">
          <Hint label={meta('insights')}>
            <Button variant="outline" size="icon-sm" asChild>
              <Link to="/app/analytics" aria-label={meta('insights')}>
                <ChartColumn />
              </Link>
            </Button>
          </Hint>
        </div>
      </header>
      {/* Meta's frame: one card with the channel tabs over list + thread, the customer panel beside it. */}
      <div className="flex min-h-0 flex-1 gap-2">
        <div
          className={cn(
            'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background md:rounded-xl md:border',
            showPanel && 'hidden xl:flex',
          )}
        >
          <div className={cn(selected && !comments && 'hidden md:block')}>
            <ChannelTabs section={section} onSection={changeSection} />
          </div>
          {comments ? (
            (renderComments?.() ?? <CommentsEntry />)
          ) : (
            <div className="flex min-h-0 flex-1">
              {list}
              {selected ? (
                <ConversationView
                  key={selected.id}
                  id={selected.id}
                  onBack={() => setSelected(null)}
                  botId={botId}
                  channel={
                    channel
                      ? {
                          name: channel.name,
                          externalId: channel.externalId,
                          removed: channel.status === 'removed',
                        }
                      : undefined
                  }
                  renderSalesPanel={renderSalesPanel}
                  renderComposerTools={renderComposerTools}
                  panelContainer={panelEl}
                  panelOpen={panelOpen}
                  onPanelOpenChange={setPanelOpen}
                />
              ) : (
                <InboxEmptyState />
              )}
            </div>
          )}
        </div>
        <aside
          ref={setPanelEl}
          aria-label={meta('panel.label')}
          className={cn(
            // `relative`: absolutely positioned form parts (hidden selects) must scroll with the panel, not the page.
            'relative w-full shrink-0 overflow-y-auto bg-background md:rounded-xl md:border xl:w-[340px] 2xl:w-[380px]',
            showPanel ? 'block' : 'hidden',
          )}
        />
      </div>
    </section>
  );
}
