import type { SendInboxMessageRequest } from '@agent-sales/contracts';
import { FileText, Loader2, Send, X, Zap } from 'lucide-react';
import { type ReactNode, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/lib/session';
import {
  draftKey,
  insertQuickReply,
  readDraft,
  subscribeDraft,
  writeDraft,
  type ComposerDraft,
} from '../lib/composer-draft';
import { useConversation, useInboxActions, useQuickReplies } from '../api/inbox';
import { AttachmentPicker } from './message-attachments';
import { InternalNoteComposer } from './internal-note-composer';

/** Text composer with attachments and quick replies; retries reuse the idempotency key. */
export function MessageComposer(props: {
  id: string;
  botId: string | null;
  windowClosed: boolean;
  renderTools?: ((insertText: (text: string) => void) => ReactNode) | undefined;
}) {
  const session = useSession();
  const scope = draftKey(session?.user.id ?? '', session?.workspaceId ?? '', props.id);
  return <ScopedComposer key={scope} {...props} scope={scope} />;
}

function ScopedComposer({
  id,
  botId,
  windowClosed,
  scope,
  renderTools,
}: {
  id: string;
  botId: string | null;
  windowClosed: boolean;
  scope: string;
  renderTools?: ((insertText: (text: string) => void) => ReactNode) | undefined;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.${key}`);
  const { send: sender } = useInboxActions(id);
  const quick = useQuickReplies(botId);
  const detail = useConversation(id);
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const saved = useSyncExternalStore(
    (listener) => subscribeDraft(scope, listener),
    () => readDraft(scope),
  );
  const draft = saved.text;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const selection = useRef({ start: draft.length, end: draft.length });
  const [delivery, setDelivery] = useState<string | null>(null);
  function rememberSelection(editor: HTMLTextAreaElement) {
    selection.current = { start: editor.selectionStart, end: editor.selectionEnd };
  }
  function save(patch: Partial<ComposerDraft>) {
    const next = { ...readDraft(scope), ...patch };
    writeDraft(scope, next);
  }
  function setDraft(text: string) {
    save({ text, attempt: null, failedAttempt: false });
    setDelivery(null);
  }
  const [quickOpen, setQuickOpen] = useState(false);
  function insertText(content: string) {
    if (sender.isPending) {
      toast.info(tr('sending'));
      return;
    }
    const current = readDraft(scope).text;
    const inserted = insertQuickReply(
      current,
      content,
      selection.current.start,
      selection.current.end,
    );
    if (!inserted) {
      toast.error(tr('sales.replyTooLong'));
      return;
    }
    setDraft(inserted.text);
    selection.current = { start: inserted.cursor, end: inserted.cursor };
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(inserted.cursor, inserted.cursor);
    });
  }

  function report(status: string) {
    if (status === 'unknown' || status === 'pending') toast.warning(tr('pendingHint'));
    else if (status === 'failed') toast.error(tr('messageFailed'));
  }
  async function send() {
    const text = draft.trim();
    if (!text || sender.isPending || windowClosed) return;
    const previous = readDraft(scope).attempt;
    const body =
      previous?.text === text && !previous.attachment && !saved.failedAttempt
        ? previous
        : { text, idempotencyKey: crypto.randomUUID() };
    save({ attempt: body, failedAttempt: false });
    setDelivery(null);
    try {
      const result = await sender.mutateAsync(body);
      if (
        result.status !== 'failed' &&
        readDraft(scope).attempt?.idempotencyKey === body.idempotencyKey
      )
        save({ text: '', attempt: null });
      if (
        result.status === 'failed' &&
        readDraft(scope).attempt?.idempotencyKey === body.idempotencyKey
      )
        save({ failedAttempt: true });
      setDelivery(result.status);
      report(result.status);
    } catch {
      toast.error(tr('messageError'));
    }
  }
  async function sendAttachment(attachment: NonNullable<SendInboxMessageRequest['attachment']>) {
    if (sender.isPending || windowClosed) return;
    try {
      const previous = readDraft(scope).attachmentAttempt;
      const body =
        previous?.attachment?.url === attachment.url &&
        previous.attachment.type === attachment.type &&
        !saved.attachmentFailedAttempt
          ? previous
          : { text: '', attachment, idempotencyKey: crypto.randomUUID() };
      save({ attachmentAttempt: body, attachmentFailedAttempt: false });
      setDelivery(null);
      const result = await sender.mutateAsync(body);
      if (
        result.status !== 'failed' &&
        readDraft(scope).attachmentAttempt?.idempotencyKey === body.idempotencyKey
      )
        save({ attachment: null, attachmentAttempt: null, attachmentFailedAttempt: false });
      if (
        result.status === 'failed' &&
        readDraft(scope).attachmentAttempt?.idempotencyKey === body.idempotencyKey
      )
        save({ attachmentFailedAttempt: true });
      setDelivery(result.status);
      report(result.status);
    } catch {
      toast.error(tr('messageError'));
    }
  }
  return (
    <div data-inbox-composer className="shrink-0 border-t bg-background p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between text-xs">
        <div className="flex gap-1" role="group" aria-label={tr('sales.composerMode')}>
          <Button
            size="sm"
            variant={mode === 'reply' ? 'secondary' : 'ghost'}
            aria-pressed={mode === 'reply'}
            onClick={() => setMode('reply')}
          >
            {tr('sales.replyToCustomer')}
          </Button>
          <Button
            size="sm"
            variant={mode === 'note' ? 'secondary' : 'ghost'}
            aria-pressed={mode === 'note'}
            disabled={!detail.data}
            onClick={() => setMode('note')}
          >
            {tr('sales.internalNote')}
          </Button>
        </div>
        <span className="hidden text-muted-foreground sm:inline">{tr('sales.draftInTab')}</span>
      </div>
      {mode === 'note' && detail.data ? (
        <InternalNoteComposer
          id={id}
          scope={scope}
          note={detail.data.conversation.note}
          revision={detail.data.conversation.revision}
        />
      ) : (
        <>
          {windowClosed ? (
            <p role="status" className="mb-3 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              {tr('windowClosed')}
            </p>
          ) : null}
          {delivery === 'unknown' || delivery === 'pending' ? (
            <p role="status" className="mb-2 rounded-lg bg-warning-soft p-2 text-xs">
              {tr('pendingHint')}
            </p>
          ) : delivery === 'failed' || saved.failedAttempt || saved.attachmentFailedAttempt ? (
            <p role="alert" className="mb-2 text-xs text-destructive">
              {tr('messageFailed')}
            </p>
          ) : null}
          {sender.isError ? (
            <p role="alert" className="mb-2 text-xs text-destructive">
              {tr('messageError')}
            </p>
          ) : null}
          {saved.attachment ? (
            <div className="mb-2 flex items-center gap-3 rounded-lg border p-2">
              {saved.attachment.type === 'image' ? (
                <img
                  src={saved.attachment.url}
                  alt={tr('attachment.image')}
                  referrerPolicy="no-referrer"
                  className="size-12 rounded object-cover"
                />
              ) : (
                <FileText className="size-8 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate text-xs">{tr('sales.attachmentReady')}</span>
              <Button
                size="sm"
                disabled={sender.isPending || windowClosed}
                onClick={() => {
                  if (saved.attachment) void sendAttachment(saved.attachment);
                }}
              >
                {tr(saved.attachmentFailedAttempt ? 'sales.retrySend' : 'sales.sendAttachment')}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={tr('sales.removeAttachment')}
                disabled={sender.isPending}
                onClick={() =>
                  save({
                    attachment: null,
                    attachmentAttempt: null,
                    attachmentFailedAttempt: false,
                  })
                }
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : null}
          <div className="rounded-xl border bg-muted/20 p-2">
            <Textarea
              ref={textarea}
              onSelect={(event) => rememberSelection(event.currentTarget)}
              onBlur={(event) => rememberSelection(event.currentTarget)}
              aria-label={tr('composer')}
              placeholder={tr('composer')}
              maxLength={2000}
              value={draft}
              disabled={sender.isPending}
              onChange={(event) => {
                rememberSelection(event.currentTarget);
                setDraft(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              className="min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                <AttachmentPicker
                  botId={botId}
                  disabled={sender.isPending || windowClosed}
                  onPick={(attachment) =>
                    save({ attachment, attachmentAttempt: null, attachmentFailedAttempt: false })
                  }
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
                            insertText(item.content);
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
                <fieldset disabled={sender.isPending} className="contents">
                  {renderTools?.(insertText)}
                </fieldset>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <span className="text-[10px] text-muted-foreground">{draft.length}/2000</span>
                <Button
                  size="sm"
                  aria-label={tr(
                    sender.isPending ? 'sending' : saved.failedAttempt ? 'sales.retrySend' : 'send',
                  )}
                  disabled={!draft.trim() || sender.isPending || windowClosed}
                  onClick={() => void send()}
                >
                  {sender.isPending ? <Loader2 className="animate-spin" /> : <Send />}
                  <span className="hidden sm:inline">
                    {tr(
                      sender.isPending
                        ? 'sending'
                        : saved.failedAttempt
                          ? 'sales.retrySend'
                          : 'send',
                    )}
                  </span>
                </Button>
              </div>
            </div>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{tr('sendHint')}</p>
        </>
      )}
    </div>
  );
}
