import type { InboxConversation, InboxUpdateBody } from '../lib/inbox-v2-types';
import { ArrowLeft, CircleAlert, Loader2, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { ApiClientError } from '@/lib/api-client';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useConversation, useInboxActions, useInboxBot, useInboxMembers } from '../api/inbox';
import { useSession } from '@/lib/session';
import { useCan } from '@/lib/permissions';
import { useReadOnOpen } from '../hooks/use-read-on-open';
import { ConversationHeader, type HeaderChannel } from './conversation-header';
import { CustomerPanel } from './customer-panel';
import { MessageComposer } from './message-composer';
import { MessageThread } from './message-thread';
import { useTagBarExpanded } from '../hooks/use-tag-bar-expanded';
import { ConversationTagBar } from './conversation-tag-bar';
import { useConversationShortcuts } from '../hooks/use-conversation-shortcuts';

/** An open conversation: header with takeover, thread, composer and customer panel. */
export function ConversationView({
  id,
  onBack,
  botId,
  channel,
  renderSalesPanel,
  renderComposerTools,
}: {
  id: string;
  onBack: () => void;
  botId: string | null;
  channel?: HeaderChannel | undefined;
  renderSalesPanel?: ((conversation: InboxConversation) => ReactNode) | undefined;
  renderComposerTools?:
    | ((conversation: InboxConversation, insertText: (text: string) => void) => ReactNode)
    | undefined;
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
  const [tagsExpanded, setTagsExpanded] = useTagBarExpanded(session?.workspaceId ?? '', userId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [details, setDetails] = useState(
    () =>
      typeof window.matchMedia === 'function' && window.matchMedia('(min-width:1280px)').matches,
  );
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
      if (c) void change({ status: c.status === 'resolved' ? 'open' : 'resolved' });
    },
    onOpenTags: canEdit ? () => setPickerOpen(true) : undefined,
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
  return (
    <div ref={root} className="flex min-h-0 min-w-0 flex-1">
      <div className={cn('flex min-w-0 flex-1 flex-col', details && 'hidden xl:flex')}>
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
          onToggleDetails={() => setDetails((open) => !open)}
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
              count: detail.data.messages.filter((message) =>
                message.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
              ).length,
            })}
          </p>
        ) : null}
        <MessageThread
          newAfter={divider.at}
          newUnread={divider.unread}
          messages={
            search
              ? detail.data.messages.filter((message) =>
                  message.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                )
              : detail.data.messages
          }
        />
        <ConversationTagBar
          id={id}
          fallbackTags={c.tags}
          expanded={tagsExpanded}
          onExpandedChange={setTagsExpanded}
          pickerOpen={pickerOpen}
          onPickerOpenChange={setPickerOpen}
          readOnly={!canEdit}
        />
        <MessageComposer
          id={id}
          botId={botId}
          windowClosed={windowClosed}
          renderTools={
            renderComposerTools ? (insertText) => renderComposerTools(c, insertText) : undefined
          }
        />
      </div>
      <aside
        className={cn(
          'relative w-full shrink-0 overflow-y-auto border-l bg-background xl:w-[340px] 2xl:w-[380px]',
          details ? 'block' : 'hidden',
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          className="m-3 xl:hidden"
          onClick={() => setDetails(false)}
        >
          <ArrowLeft />
          {tr('back')}
        </Button>
        {renderSalesPanel ? renderSalesPanel(c) : <CustomerPanel conversation={c} />}
      </aside>
    </div>
  );
}
