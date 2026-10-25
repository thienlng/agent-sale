import type { ConversationDto, UpdateConversationRequest } from '@agent-sales/contracts';
import {
  ArrowLeft,
  Bot,
  CircleAlert,
  Loader2,
  UserRound,
  CheckCheck,
  Search,
  X,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { ApiClientError } from '@/lib/api-client';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useConversation, useInboxActions } from '../api/inbox';
import { CustomerAvatar } from './customer-avatar';
import { CustomerPanel } from './customer-panel';
import { MessageComposer } from './message-composer';
import { MessageThread } from './message-thread';
import { useConversationShortcuts } from '../hooks/use-conversation-shortcuts';

/** An open conversation: header with takeover, thread, composer and customer panel. */
export function ConversationView({
  id,
  onBack,
  botId,
  renderSalesPanel,
  renderComposerTools,
}: {
  id: string;
  onBack: () => void;
  botId: string | null;
  renderSalesPanel?: ((conversation: ConversationDto) => ReactNode) | undefined;
  renderComposerTools?:
    ((conversation: ConversationDto, insertText: (text: string) => void) => ReactNode) | undefined;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.${key}`, options ?? {});
  const detail = useConversation(id);
  const { update } = useInboxActions(id);
  const [details, setDetails] = useState(
    () =>
      typeof window.matchMedia === 'function' && window.matchMedia('(min-width:1280px)').matches,
  );
  const c = detail.data?.conversation;
  const root = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  async function change(body: UpdateConversationRequest) {
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
  useConversationShortcuts({
    root,
    enabled: Boolean(c),
    busy: update.isPending,
    onToggleResolved: () => {
      if (c) void change({ status: c.status === 'resolved' ? 'open' : 'resolved' });
    },
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
        <header className="flex min-h-20 flex-wrap items-center gap-3 border-b px-4 py-3">
          <Button
            size="icon"
            variant="ghost"
            className="md:hidden"
            aria-label={tr('back')}
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
          <CustomerAvatar conversation={c} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold">{c.customerName}</h2>
            <span className="text-xs text-muted-foreground">
              {c.provider === 'facebook' ? 'Facebook Messenger' : 'Instagram'}
              {' · '}
              {tr(c.status)}
            </span>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={tr('sales.searchThread')}
            onClick={() => setSearchOpen((open) => !open)}
          >
            <Search />
          </Button>
          <Button
            size="icon-sm"
            variant={c.status === 'resolved' ? 'secondary' : 'ghost'}
            aria-label={tr(c.status === 'resolved' ? 'sales.reopen' : 'sales.resolve')}
            title={`${tr(c.status === 'resolved' ? 'sales.reopen' : 'sales.resolve')} (E)`}
            aria-keyshortcuts="E"
            disabled={update.isPending}
            onClick={() => void change({ status: c.status === 'resolved' ? 'open' : 'resolved' })}
          >
            <CheckCheck />
          </Button>
          <Button
            size="sm"
            variant={c.mode === 'bot' ? 'secondary' : 'outline'}
            disabled={update.isPending || (c.mode === 'human' && !botId)}
            onClick={() => void change({ mode: c.mode === 'bot' ? 'human' : 'bot' })}
          >
            {c.mode === 'bot' ? <Bot /> : <UserRound />}
            {tr(c.mode === 'bot' ? 'takeOver' : 'resumeBot')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={details}
            onClick={() => setDetails((open) => !open)}
          >
            {details ? <PanelRightClose /> : <PanelRightOpen />}
            {tr(details ? 'sales.collapsePanel' : 'details')}
          </Button>
        </header>
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground"
        >
          {c.mode === 'bot' ? (
            <Bot className="size-3.5 text-primary" />
          ) : (
            <UserRound className="size-3.5" />
          )}
          {tr(c.mode === 'bot' ? 'sales.aiActive' : 'sales.staffActive')}
          {c.mode === 'human' && c.autoResumeAt ? (
            <span>
              {tr(Date.parse(c.autoResumeAt) > clock ? 'sales.resumeAt' : 'sales.resumeNext', {
                time: new Date(c.autoResumeAt).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              })}
            </span>
          ) : null}
        </div>
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
          messages={
            search
              ? detail.data.messages.filter((message) =>
                  message.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                )
              : detail.data.messages
          }
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
        {renderSalesPanel ? (
          renderSalesPanel(c)
        ) : (
          <CustomerPanel
            conversation={c}
            busy={update.isPending}
            onChange={(body) => void change(body)}
          />
        )}
      </aside>
    </div>
  );
}
