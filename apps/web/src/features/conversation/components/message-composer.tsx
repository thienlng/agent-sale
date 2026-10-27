import type { SendInboxMessageRequest } from '@agent-sales/contracts';
import { FileText, Loader2, Send, ThumbsUp, X } from 'lucide-react';
import { type ReactNode, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ApiClientError } from '@/lib/api-client';
import { useSession } from '@/lib/session';
import { useQueryClient } from '@tanstack/react-query';
import {
  draftKey,
  filterSlashReplies,
  insertQuickReply,
  readDraft,
  slashQuery,
  subscribeDraft,
  writeDraft,
  type ComposerDraft,
} from '../lib/composer-draft';
import { useInboxActions, useQuickReplies } from '../api/inbox';
import { EmojiPicker } from './emoji-picker';
import { AttachmentPicker } from './message-attachments';
import { QuickRepliesMenu } from './quick-replies-menu';
import { SlashReplies } from './slash-replies';

/** Text composer with attachments and quick replies; retries reuse the idempotency key. */
export function MessageComposer(props: {
  id: string;
  botId: string | null;
  windowClosed: boolean;
  /** Done or Spam: staff reopen before replying; the draft stays editable. */
  locked?: boolean | undefined;
  /** "Messenger" / "Instagram" for the placeholder. */
  channelLabel?: string | undefined;
  renderTools?: ((insertText: (text: string) => void) => ReactNode) | undefined;
}) {
  const session = useSession();
  const scope = draftKey(session?.user.id ?? '', session?.workspaceId ?? '', props.id);
  return <ScopedComposer key={scope} {...props} scope={scope} />;
}

function ScopedComposer({
  id,
  botId,
  windowClosed: closedWindow,
  locked = false,
  channelLabel,
  scope,
  renderTools,
}: {
  id: string;
  botId: string | null;
  windowClosed: boolean;
  locked?: boolean | undefined;
  channelLabel?: string | undefined;
  scope: string;
  renderTools?: ((insertText: (text: string) => void) => ReactNode) | undefined;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.${key}`);
  const { send: sender } = useInboxActions(id);
  const qc = useQueryClient();
  // Nothing may leave while the window is closed or the conversation sits in Done / Spam.
  const windowClosed = closedWindow || locked;
  const quick = useQuickReplies(botId);
  const [focused, setFocused] = useState(false);
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
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState<string | null>(null);
  const query = botId ? slashQuery(draft) : null;
  const slashMatches = query !== null ? filterSlashReplies(quick.data ?? [], query) : [];
  const slashOpen = query !== null && slashDismissed !== draft;
  const slashActive = Math.min(slashIndex, Math.max(slashMatches.length - 1, 0));
  function pickSlash(content: string) {
    const inserted = insertQuickReply('', content, 0, 0);
    if (!inserted) {
      toast.error(tr('sales.replyTooLong'));
      return;
    }
    setDraft(inserted.text);
    selection.current = { start: inserted.cursor, end: inserted.cursor };
    requestAnimationFrame(() =>
      textarea.current?.setSelectionRange(inserted.cursor, inserted.cursor),
    );
  }
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
    } catch (error) {
      failSend(error);
    }
  }
  /** A 409 means the conversation moved to Done/Spam (or the window closed) meanwhile: say so and reload it. */
  function failSend(error: unknown) {
    if (error instanceof ApiClientError && error.code === 'FORBIDDEN')
      toast.error(t('channelInbox.meta.locked.readOnly'));
    else if (error instanceof ApiClientError && error.code === 'CONFLICT') {
      toast.error(t('channelInbox.meta.composer.notSent'));
      void qc.invalidateQueries({ queryKey: ['conversation'] });
    } else toast.error(tr('messageError'));
  }
  /** Meta's thumbs-up: a real message, offered only while the draft is empty. */
  async function sendLike() {
    if (sender.isPending || windowClosed || draft.trim()) return;
    try {
      const result = await sender.mutateAsync({ text: '👍', idempotencyKey: crypto.randomUUID() });
      setDelivery(result.status);
      report(result.status);
    } catch (error) {
      failSend(error);
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
    } catch (error) {
      failSend(error);
    }
  }
  return (
    <div data-inbox-composer className="shrink-0 bg-background px-3 pt-1 pb-3 sm:px-4">
      <>
        {closedWindow && !locked ? (
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
        <div className="relative rounded-xl border bg-background p-2 focus-within:border-primary/50">
          {slashOpen ? (
            <SlashReplies
              items={slashMatches}
              active={slashActive}
              onPick={(item) => pickSlash(item.content)}
            />
          ) : null}
          <Textarea
            ref={textarea}
            onSelect={(event) => rememberSelection(event.currentTarget)}
            onBlur={(event) => {
              rememberSelection(event.currentTarget);
              setFocused(false);
            }}
            aria-label={tr('composer')}
            placeholder={
              focused && !draft
                ? tr('v2.slash.hint')
                : channelLabel
                  ? t('channelInbox.meta.composer.replyIn', { channel: channelLabel })
                  : tr('composer')
            }
            onFocus={() => setFocused(true)}
            maxLength={2000}
            value={draft}
            disabled={sender.isPending}
            onChange={(event) => {
              rememberSelection(event.currentTarget);
              setDraft(event.currentTarget.value);
              setSlashIndex(0);
            }}
            aria-autocomplete="list"
            aria-expanded={slashOpen}
            aria-controls={slashOpen ? 'slash-replies' : undefined}
            onKeyDown={(event) => {
              if (slashOpen && !event.nativeEvent.isComposing) {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setSlashDismissed(draft);
                  return;
                }
                if (slashMatches.length) {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const step = event.key === 'ArrowDown' ? 1 : -1;
                    setSlashIndex((slashActive + step + slashMatches.length) % slashMatches.length);
                    return;
                  }
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    const item = slashMatches[slashActive];
                    if (item) pickSlash(item.content);
                    return;
                  }
                }
              }
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
            className="max-h-48 min-h-14 resize-none border-0 bg-transparent px-1 text-[15px] shadow-none focus-visible:ring-0"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="pl-1 text-[10px] text-muted-foreground tabular-nums">
              {draft.length > 1500 ? `${draft.length}/2000` : null}
            </span>
            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-0.5">
              <AttachmentPicker
                botId={botId}
                disabled={sender.isPending || windowClosed}
                onPick={(attachment) =>
                  save({ attachment, attachmentAttempt: null, attachmentFailedAttempt: false })
                }
              />
              <QuickRepliesMenu quick={quick} disabled={!botId} onPick={insertText} />
              <EmojiPicker disabled={sender.isPending} onPick={insertText} />
              <fieldset disabled={sender.isPending} className="contents">
                {renderTools?.(insertText)}
              </fieldset>
              {!draft.trim() && !saved.failedAttempt ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-primary"
                  aria-label={t('channelInbox.meta.composer.like')}
                  title={t('channelInbox.meta.composer.like')}
                  disabled={sender.isPending || windowClosed}
                  onClick={() => void sendLike()}
                >
                  {sender.isPending ? <Loader2 className="animate-spin" /> : <ThumbsUp />}
                </Button>
              ) : (
                <Button
                  size="sm"
                  title={tr('sendHint')}
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
              )}
            </div>
          </div>
        </div>
      </>
    </div>
  );
}
