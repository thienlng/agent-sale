import type {
  ConversationDto,
  MetaProvider,
  SendInboxMessageRequest,
} from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  Bot,
  CheckCheck,
  CircleAlert,
  MessageCircle as Facebook,
  Camera as Instagram,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  UserRound,
  UsersRound,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { AttachmentPicker, MessageAttachments } from './message-attachments';
import {
  useConversation,
  useInbox,
  useInboxActions,
  useInboxChannels,
  useQuickReplies,
} from '../api/inbox';
const nameOf = (c: ConversationDto) => c.customerName;
/** The API stores "[image]"-style markers for media-only messages; show them localized. */
function previewText(text: string, tr: (key: string) => string) {
  if (!text) return tr('noMessage');
  const media = /^\[(image|video|audio|file|sticker)\]$/.exec(text)?.[1];
  return media
    ? tr(media === 'image' || media === 'sticker' ? 'attachment.image' : 'attachment.file')
    : text;
}
export function InboxPage() {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`channelInbox.${key}`);
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [provider, setProvider] = useState<MetaProvider | 'all'>('all');
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open');
  const [mode, setMode] = useState<'bot' | 'human' | 'all'>('all');
  const inbox = useInbox({
    q,
    ...(provider !== 'all' ? { provider } : {}),
    ...(status !== 'all' ? { status } : {}),
    ...(mode !== 'all' ? { mode } : {}),
    limit: 100,
  });
  const channels = useInboxChannels();
  const time = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(
      new Date(value),
    );
  return (
    <section
      data-content-padding="false"
      className="flex min-h-[calc(100svh-3.25rem)] w-full min-w-0 flex-1 overflow-hidden bg-background lg:h-[calc(100svh-3.25rem)]"
    >
      <aside
        className={cn(
          'flex w-full shrink-0 flex-col border-r bg-background md:w-80',
          selected ? 'hidden md:flex' : 'flex',
        )}
      >
        <div className="space-y-3 border-b p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold">{tr('inboxTitle')}</h1>
            <Button
              variant="ghost"
              size="icon"
              aria-label={tr('refresh')}
              onClick={() => void inbox.refetch()}
            >
              <RefreshCw className={inbox.isFetching ? 'animate-spin' : ''} />
            </Button>
          </div>
          <Select value={provider} onValueChange={(value) => setProvider(value as typeof provider)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tr('allChannels')}</SelectItem>
              <SelectItem value="facebook">Facebook</SelectItem>
              <SelectItem value="instagram">Instagram</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              aria-label={tr('search')}
              placeholder={tr('search')}
              value={q}
              onChange={(event) => setQ(event.target.value)}
              className="pl-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
              <SelectTrigger className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tr('allStatuses')}</SelectItem>
                <SelectItem value="open">{tr('open')}</SelectItem>
                <SelectItem value="resolved">{tr('resolved')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
              <SelectTrigger className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tr('allModes')}</SelectItem>
                <SelectItem value="bot">{tr('botMode')}</SelectItem>
                <SelectItem value="human">{tr('human')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ArrowDownWideNarrow className="size-3.5" />
              {tr('newest')}
            </span>
            {inbox.data ? <span>{inbox.data.data.length}</span> : null}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {inbox.isPending ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2, 3].map((n) => (
                <Skeleton key={n} className="h-16" />
              ))}
            </div>
          ) : inbox.isError ? (
            <div role="alert" className="p-5 text-center text-sm">
              <CircleAlert className="mx-auto mb-2 size-6 text-destructive" />
              <p>{tr('loadError')}</p>
              <Button className="mt-3" variant="outline" onClick={() => void inbox.refetch()}>
                {tr('retry')}
              </Button>
            </div>
          ) : inbox.data?.data.length ? (
            <ul className="divide-y">
              {inbox.data.data.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(c.id)}
                    className={cn(
                      'flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-muted/50',
                      selected === c.id && 'bg-primary-soft/60',
                    )}
                  >
                    <CustomerAvatar conversation={c} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{nameOf(c)}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {time(c.updatedAt)}
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {previewText(c.lastMessage, tr)}
                      </span>
                      <span className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        {c.mode === 'bot' ? (
                          <Bot className="size-3" />
                        ) : (
                          <UserRound className="size-3" />
                        )}
                        {tr(c.mode === 'bot' ? 'botMode' : 'human')}
                        {c.status === 'resolved' ? (
                          <CheckCheck className="ml-auto size-3.5 text-success" />
                        ) : null}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center px-5 py-12 text-center">
              <MessageCircle className="mb-3 size-9 text-muted-foreground" />
              <h2 className="text-sm font-semibold">
                {tr(q || provider !== 'all' || mode !== 'all' ? 'emptyFilter' : 'emptyInbox')}
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {tr('emptyInboxBody')}
              </p>
              {!channels.data?.data.some((c) => c.status === 'connected') ? (
                <Button variant="outline" className="mt-4" asChild>
                  <Link to="/app/channels">{tr('connect')}</Link>
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </aside>
      {selected ? (
        <ConversationView
          key={selected}
          id={selected}
          onBack={() => setSelected(null)}
          botId={
            channels.data?.data.find(
              (c) => c.id === inbox.data?.data.find((item) => item.id === selected)?.channelId,
            )?.botId ?? null
          }
        />
      ) : (
        <div className="hidden min-w-0 flex-1 flex-col items-center justify-center bg-muted/20 p-8 text-center md:flex">
          <span className="grid size-24 place-items-center rounded-3xl bg-primary-soft text-primary">
            <MessageCircle className="size-11" />
          </span>
          <h2 className="mt-6 text-xl font-semibold">{tr('selectConversation')}</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {tr('selectConversationBody')}
          </p>
        </div>
      )}
    </section>
  );
}
function CustomerAvatar({ conversation: c }: { conversation: ConversationDto }) {
  return (
    <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
      {c.customerName.slice(0, 2).toUpperCase()}
      <span className="absolute -right-1 -bottom-1 grid size-4.5 place-items-center rounded-full border-2 border-background bg-primary text-primary-foreground">
        {c.provider === 'facebook' ? (
          <Facebook className="size-2.5" />
        ) : (
          <Instagram className="size-2.5" />
        )}
      </span>
    </span>
  );
}
function ConversationView({
  id,
  onBack,
  botId,
}: {
  id: string;
  onBack: () => void;
  botId: string | null;
}) {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`channelInbox.${key}`);
  const detail = useConversation(id);
  const actions = useInboxActions(id);
  const quick = useQuickReplies(botId);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const lastAttempt = useRef<{ text: string; idempotencyKey: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const c = detail.data?.conversation;
  const messages = detail.data?.messages ?? [];
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);
  const windowClosed = Boolean(c && Date.now() - Date.parse(c.lastInboundAt) >= 86400000);
  async function change(body: Parameters<typeof actions.update.mutateAsync>[0]) {
    try {
      await actions.update.mutateAsync(body);
      toast.success(tr('updated'));
    } catch {
      toast.error(tr('loadError'));
    }
  }
  async function send() {
    const text = draft.trim();
    if (!text || actions.send.isPending || windowClosed) return;
    const body =
      lastAttempt.current?.text === text
        ? lastAttempt.current
        : { text, idempotencyKey: crypto.randomUUID() };
    lastAttempt.current = body;
    try {
      const result = await actions.send.mutateAsync(body);
      setDraft('');
      lastAttempt.current = null;
      if (result.status === 'unknown' || result.status === 'pending')
        toast.warning(tr('pendingHint'));
      else if (result.status === 'failed') toast.error(tr('messageFailed'));
    } catch {
      toast.error(tr('messageError'));
    }
  }
  async function sendAttachment(attachment: NonNullable<SendInboxMessageRequest['attachment']>) {
    if (actions.send.isPending || windowClosed) return;
    try {
      const result = await actions.send.mutateAsync({
        text: '',
        attachment,
        idempotencyKey: crypto.randomUUID(),
      });
      if (result.status === 'unknown' || result.status === 'pending')
        toast.warning(tr('pendingHint'));
      else if (result.status === 'failed') toast.error(tr('messageFailed'));
    } catch {
      toast.error(tr('messageError'));
    }
  }
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
        className="flex min-w-0 flex-1 flex-col items-center justify-center p-6 text-center"
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
  const stamp = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  const customerPanel = (
    <>
      <div className="border-b p-5">
        <div className="flex items-center gap-3">
          <CustomerAvatar conversation={c} />
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{nameOf(c)}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{tr('customer')}</p>
          </div>
        </div>
      </div>
      <div className="space-y-5 p-5">
        <div>
          <Label className="text-xs text-muted-foreground">{tr('channel')}</Label>
          <p className="mt-1 text-sm">{c.provider === 'facebook' ? 'Facebook' : 'Instagram'}</p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">{tr('customerId')}</Label>
          <p className="mt-1 break-all text-sm">{c.customerId}</p>
        </div>
        <div>
          <Label className="mb-2">{tr('status')}</Label>
          <Select
            value={c.status}
            disabled={actions.update.isPending}
            onValueChange={(status) => void change({ status: status as 'open' | 'resolved' })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">{tr('open')}</SelectItem>
              <SelectItem value="resolved">{tr('resolved')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="rounded-xl border p-3">
          <p className="flex items-center gap-2 text-sm">
            <UsersRound className="size-4 text-muted-foreground" />
            {tr(c.assigneeId ? 'assigned' : 'unassigned')}
          </p>
          <Button
            className="mt-3 w-full"
            size="sm"
            variant="outline"
            disabled={actions.update.isPending}
            onClick={() => void change({ assignToMe: !c.assigneeId })}
          >
            {tr(c.assigneeId ? 'unassign' : 'claim')}
          </Button>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`note-${id}`}>{tr('notes')}</Label>
          <Textarea
            id={`note-${id}`}
            value={note ?? c.note}
            placeholder={tr('notesPlaceholder')}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-28 resize-y"
            maxLength={10000}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={actions.update.isPending || note === null || note === c.note}
            onClick={() => void change({ note: note ?? c.note })}
          >
            {tr('saveNotes')}
          </Button>
        </div>
      </div>
    </>
  );
  return (
    <div className="flex min-w-0 flex-1">
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
            <h2 className="truncate font-semibold">{nameOf(c)}</h2>
            <span className="text-xs text-muted-foreground">
              {c.provider === 'facebook' ? 'Facebook Messenger' : 'Instagram'}
            </span>
          </div>
          <Button
            size="sm"
            variant={c.mode === 'bot' ? 'secondary' : 'outline'}
            disabled={actions.update.isPending || (c.mode === 'human' && !botId)}
            onClick={() => void change({ mode: c.mode === 'bot' ? 'human' : 'bot' })}
          >
            {c.mode === 'bot' ? <Bot /> : <UserRound />}
            {tr(c.mode === 'bot' ? 'takeOver' : 'resumeBot')}
          </Button>
          <Button size="sm" variant="ghost" className="xl:hidden" onClick={() => setDetails(true)}>
            {tr('details')}
          </Button>
        </header>
        <div
          role="log"
          aria-label={tr('inboxTitle')}
          className="flex min-h-80 flex-1 flex-col gap-4 overflow-y-auto bg-muted/20 p-4 sm:p-6"
        >
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                'flex max-w-[88%] flex-col',
                m.direction === 'outbound' ? 'self-end items-end' : 'self-start items-start',
              )}
            >
              <div
                className={cn(
                  'rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words',
                  m.direction === 'outbound'
                    ? 'rounded-br-sm bg-primary-soft text-foreground'
                    : 'rounded-bl-sm border bg-background',
                )}
              >
                <MessageAttachments items={m.attachments} />
                {m.text || (m.attachments.length ? null : tr('noMessage'))}
              </div>
              <span className="mt-1 text-[10px] text-muted-foreground">
                {stamp(m.createdAt)}
                {m.direction === 'outbound'
                  ? ` · ${tr(m.sender === 'bot' ? 'botSent' : 'humanSent')}`
                  : ''}
              </span>
              {m.direction === 'outbound' ? (
                <span
                  className={cn(
                    'mt-0.5 flex items-center gap-1 text-[10px]',
                    m.status === 'failed' || m.status === 'unknown'
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                  )}
                >
                  {m.status === 'sent' ? (
                    <CheckCheck className="size-3" />
                  ) : m.status === 'pending' ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <CircleAlert className="size-3" />
                  )}
                  {tr(m.status)}
                </span>
              ) : null}
            </div>
          ))}
          <div ref={bottom} />
        </div>
        <div className="border-t bg-background p-3 sm:p-4">
          {windowClosed ? (
            <p role="status" className="mb-3 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              {tr('windowClosed')}
            </p>
          ) : null}
          {actions.send.isError ? (
            <p role="alert" className="mb-2 text-xs text-destructive">
              {tr('messageError')}
            </p>
          ) : null}
          <div className="rounded-xl border bg-muted/20 p-2">
            <Textarea
              aria-label={tr('composer')}
              placeholder={tr('composer')}
              maxLength={2000}
              value={draft}
              disabled={actions.send.isPending || windowClosed}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              className="min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <AttachmentPicker
                  botId={botId}
                  disabled={actions.send.isPending || windowClosed}
                  onPick={(attachment) => void sendAttachment(attachment)}
                />
                <Popover open={quickOpen} onOpenChange={setQuickOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" disabled={!botId}>
                      <Zap className="size-4" />
                      {tr('quickReplies')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="max-h-72 overflow-y-auto p-2">
                    {quick.isPending ? (
                      <p className="p-3 text-xs text-muted-foreground">{tr('loading')}</p>
                    ) : quick.isError ? (
                      <p role="alert" className="p-3 text-xs text-destructive">
                        {tr('loadError')}
                      </p>
                    ) : quick.data?.length ? (
                      quick.data.map((item) => (
                        <button
                          type="button"
                          key={item.id}
                          className="block w-full rounded-lg p-3 text-left hover:bg-muted"
                          onClick={() => {
                            setDraft(item.content.slice(0, 2000));
                            setQuickOpen(false);
                          }}
                        >
                          <span className="block text-sm font-medium">{item.title}</span>
                          <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">
                            {item.content}
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="p-3 text-xs text-muted-foreground">{tr('noQuickReplies')}</p>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">{draft.length}/2000</span>
                <Button
                  size="sm"
                  aria-label={tr(actions.send.isPending ? 'sending' : 'send')}
                  disabled={!draft.trim() || actions.send.isPending || windowClosed}
                  onClick={() => void send()}
                >
                  {actions.send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
                  <span className="hidden sm:inline">
                    {tr(actions.send.isPending ? 'sending' : 'send')}
                  </span>
                </Button>
              </div>
            </div>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{tr('sendHint')}</p>
        </div>
      </div>
      <aside
        className={cn(
          'w-full shrink-0 overflow-y-auto border-l bg-background xl:block xl:w-72 2xl:w-80',
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
        {customerPanel}
      </aside>
    </div>
  );
}
