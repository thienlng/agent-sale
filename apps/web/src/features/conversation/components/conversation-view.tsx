import type { ChannelProvider } from '@agent-sales/contracts';
import type { InboxConversation, InboxUpdateBody } from '../lib/inbox-v2-types';
import { Link } from '@tanstack/react-router';
import { CircleAlert, Loader2, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@/components/ui/input';
import { ApiClientError } from '@/lib/api-client';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConversation, useInboxActions, useInboxBot, useInboxMembers } from '../api/inbox';
import { useSession } from '@/lib/session';
import { useCan } from '@/lib/permissions';
import { customerDisplayName } from '../lib/inbox-list';
import { useReadOnOpen } from '../hooks/use-read-on-open';
import { ConversationHeader, externalInboxUrl, type HeaderChannel } from './conversation-header';
import { CustomerPanel } from './customer-panel';
import { MessageComposer } from './message-composer';
import { MessageThread } from './message-thread';
import { WebsiteVisitorBlock } from './website-visitor-block';
import { ConversationTagBar } from './conversation-tag-bar';
import { PanelBlock } from './panel-block';
import { PanelProfileHeader, SharedImagesBlock } from './panel-sections';
import { useConversationShortcuts } from '../hooks/use-conversation-shortcuts';

/** Product names shown in the composer placeholder ("Trả lời trong …"). */
const CHANNEL_LABEL: Record<ChannelProvider, string> = {
  facebook: 'Messenger',
  instagram: 'Instagram',
  website: 'Website',
};

/** Sections the conversation feature owns, placed by whoever composes the right panel. */
export interface PanelSlots {
  tags: ReactNode;
  media: ReactNode;
}

/** An open conversation: header, thread and composer, and the customer panel beside them. */
export function ConversationView({
  id,
  onBack,
  botId,
  channel,
  renderSalesPanel,
  renderComposerTools,
  panelContainer,
  panelOpen: details,
  onPanelOpenChange: setDetails,
}: {
  id: string;
  onBack: () => void;
  botId: string | null;
  channel?: HeaderChannel | undefined;
  renderSalesPanel?:
    ((conversation: InboxConversation, slots: PanelSlots) => ReactNode) | undefined;
  renderComposerTools?:
    | ((conversation: InboxConversation, insertText: (text: string) => void) => ReactNode)
    | undefined;
  /** The page's customer-panel region; the panel is rendered there, beside the list card. */
  panelContainer: HTMLElement | null;
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.${key}`, options ?? {});
  const detail = useConversation(id);
  const { update } = useInboxActions(id);
  const bot = useInboxBot(botId);
  const members = useInboxMembers();
  const session = useSession();
  const userId = session?.user.id ?? '';
  const [pickerOpen, setPickerOpen] = useState(false);
  const c = detail.data?.conversation;
  const canEdit = useCan('contacts.edit');
  const read = useReadOnOpen(id, canEdit ? c : undefined);
  const root = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  async function change(body: InboxUpdateBody) {
    try {
      await update.mutateAsync({ expectedRevision: c?.revision, ...body });
      toast.success(tr('updated'));
    } catch (error) {
      toast.error(
        error instanceof ApiClientError && error.code === 'CONFLICT'
          ? tr('sales.conflict')
          : tr('loadError'),
      );
    }
  }
  // The "Tin mới" divider marks what was unread when the conversation opened, not after it is read.
  const [openedRead, setOpenedRead] = useState<{
    at: string | null;
    unread: number;
  } | null>(null);
  if (c && !openedRead) setOpenedRead({ at: c.lastReadAt, unread: c.unreadCount });
  // After "mark unread" nobody has read it: the divider goes before the unread customer messages.
  const neverRead = c?.lastReadAt === null && (c?.unreadCount ?? 0) > 0;
  const divider = neverRead
    ? { at: null, unread: c?.unreadCount ?? 0 }
    : (openedRead ?? { at: null, unread: 0 });
  function markUnread() {
    void read
      .markUnread()
      .then(() => toast.success(tr('v2.header.marked')))
      .catch(() => toast.error(tr('loadError')));
  }
  useConversationShortcuts({
    root,
    enabled: Boolean(c),
    busy: update.isPending,
    onToggleResolved: () => {
      // Done ⇄ open; from Spam the shortcut only restores, it never files spam as Done.
      if (c) void change({ status: c.status === 'open' ? 'resolved' : 'open' });
    },
    onOpenTags: canEdit
      ? () => {
          // Tags live in the panel now: open it so the picker has somewhere to appear.
          setDetails(true);
          setPickerOpen(true);
        }
      : undefined,
    onMarkUnread: canEdit && !read.pending ? markUnread : undefined,
  });
  if (detail.isPending)
    return (
      <div role="status" className="flex flex-1 items-center justify-center">
        <Loader2 className="mr-2 size-5 animate-spin" />
        {tr('loading')}
      </div>
    );
  if (detail.isError || !c)
    return (
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center p-6 text-center"
        role="alert"
      >
        <CircleAlert className="mb-3 size-8 text-destructive" />
        <p>{tr('loadError')}</p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" onClick={onBack}>
            {tr('back')}
          </Button>
          <Button onClick={() => void detail.refetch()}>{tr('retry')}</Button>
        </div>
      </div>
    );
  const windowClosed = clock - Date.parse(c.lastInboundAt) >= 86400000;
  const folder = c.status === 'open' ? null : c.status;
  const name = customerDisplayName(c, (provider, last4) => tr('v2.row.guest', { provider, last4 }));
  const slots: PanelSlots = {
    tags: (
      <PanelBlock
        title={tr('meta.panel.tags')}
        summary={c.tags.length ? String(c.tags.length) : undefined}
      >
        <ConversationTagBar
          id={id}
          fallbackTags={c.tags}
          expanded
          onExpandedChange={() => undefined}
          pickerOpen={pickerOpen}
          onPickerOpenChange={setPickerOpen}
          readOnly={!canEdit}
          layout="panel"
        />
        <Link
          to="/app/crm-settings/tags"
          className="mt-2 inline-block text-xs text-primary hover:underline"
        >
          {tr('meta.panel.manageTags')}
        </Link>
      </PanelBlock>
    ),
    media: <SharedImagesBlock messages={detail.data.messages} />,
  };
  const matches = (text: string) => text.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  const panel = (
    <>
      <PanelProfileHeader
        conversation={c}
        pageName={channel?.name}
        externalUrl={externalInboxUrl(c.provider, channel)}
        onCollapse={() => setDetails(false)}
      />
      {c.provider === 'website' ? <WebsiteVisitorBlock conversationId={c.id} /> : null}
      {renderSalesPanel ? (
        renderSalesPanel(c, slots)
      ) : (
        <CustomerPanel conversation={c} slots={slots} />
      )}
    </>
  );
  return (
    <div ref={root} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ConversationHeader
        conversation={c}
        channel={channel}
        botAvailable={Boolean(botId) && bot.data?.isActive !== false}
        takeoverMinutes={bot.data?.takeoverMinutes}
        members={members.data ?? []}
        membersLoading={members.isPending}
        userId={userId}
        busy={update.isPending}
        now={clock}
        detailsOpen={details}
        onToggleDetails={() => setDetails(!details)}
        onBack={onBack}
        onToggleSearch={() => setSearchOpen((open) => !open)}
        onChange={(body) => void change(body)}
        onMarkUnread={markUnread}
        canEdit={canEdit}
      />
      {searchOpen ? (
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
          <Input
            autoFocus
            aria-label={tr('sales.searchThread')}
            placeholder={tr('sales.searchThread')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={tr('sales.closeSearch')}
            onClick={() => {
              setSearchOpen(false);
              setSearch('');
            }}
          >
            <X />
          </Button>
        </div>
      ) : null}
      {search ? (
        <p role="status" className="px-4 py-2 text-xs text-muted-foreground">
          {tr('sales.searchMatches', {
            count: detail.data.messages.filter((message) => matches(message.text)).length,
          })}
        </p>
      ) : null}
      <MessageThread
        newAfter={divider.at}
        newUnread={divider.unread}
        customer={{ conversation: c, name }}
        messages={
          search
            ? detail.data.messages.filter((message) => matches(message.text))
            : detail.data.messages
        }
      />
      {!canEdit ? (
        <p role="status" className="mx-3 mb-2 rounded-lg bg-muted px-3 py-2 text-xs sm:mx-4">
          {tr('meta.locked.readOnly')}
        </p>
      ) : channel?.removed ? (
        <p role="status" className="mx-3 mb-2 rounded-lg bg-muted px-3 py-2 text-xs sm:mx-4">
          {tr('meta.locked.pageRemoved')}
        </p>
      ) : folder ? (
        <div
          role="status"
          className="mx-3 mb-2 flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-xs sm:mx-4"
        >
          <span>{tr(`meta.locked.${folder}`)}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={update.isPending || !canEdit}
            onClick={() => void change({ status: 'open' })}
          >
            {tr('meta.locked.reopen')}
          </Button>
        </div>
      ) : null}
      <MessageComposer
        id={id}
        botId={botId}
        windowClosed={windowClosed}
        locked={folder !== null || !canEdit || channel?.removed === true}
        channelLabel={CHANNEL_LABEL[c.provider]}
        channelId={c.channelId}
        renderTools={
          renderComposerTools ? (insertText) => renderComposerTools(c, insertText) : undefined
        }
      />
      {panelContainer ? createPortal(panel, panelContainer) : null}
    </div>
  );
}
