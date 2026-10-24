import type { SendInboxMessageRequest } from '@agent-sales/contracts';
import { Loader2, Send, Zap } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { useInboxActions, useQuickReplies } from '../api/inbox';
import { AttachmentPicker } from './message-attachments';

/** Text composer with attachments and quick replies; retries reuse the idempotency key. */
export function MessageComposer({
  id,
  botId,
  windowClosed,
}: {
  id: string;
  botId: string | null;
  windowClosed: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.${key}`);
  const { send: sender } = useInboxActions(id);
  const quick = useQuickReplies(botId);
  const [draft, setDraft] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);
  const lastAttempt = useRef<{ text: string; idempotencyKey: string } | null>(null);

  function report(status: string) {
    if (status === 'unknown' || status === 'pending') toast.warning(tr('pendingHint'));
    else if (status === 'failed') toast.error(tr('messageFailed'));
  }
  async function send() {
    const text = draft.trim();
    if (!text || sender.isPending || windowClosed) return;
    const body =
      lastAttempt.current?.text === text
        ? lastAttempt.current
        : { text, idempotencyKey: crypto.randomUUID() };
    lastAttempt.current = body;
    try {
      const result = await sender.mutateAsync(body);
      setDraft('');
      lastAttempt.current = null;
      report(result.status);
    } catch {
      toast.error(tr('messageError'));
    }
  }
  async function sendAttachment(attachment: NonNullable<SendInboxMessageRequest['attachment']>) {
    if (sender.isPending || windowClosed) return;
    try {
      const result = await sender.mutateAsync({
        text: '',
        attachment,
        idempotencyKey: crypto.randomUUID(),
      });
      report(result.status);
    } catch {
      toast.error(tr('messageError'));
    }
  }
  return (
    <div className="border-t bg-background p-3 sm:p-4">
      {windowClosed ? (
        <p role="status" className="mb-3 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          {tr('windowClosed')}
        </p>
      ) : null}
      {sender.isError ? (
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
          disabled={sender.isPending || windowClosed}
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
              disabled={sender.isPending || windowClosed}
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
              aria-label={tr(sender.isPending ? 'sending' : 'send')}
              disabled={!draft.trim() || sender.isPending || windowClosed}
              onClick={() => void send()}
            >
              {sender.isPending ? <Loader2 className="animate-spin" /> : <Send />}
              <span className="hidden sm:inline">{tr(sender.isPending ? 'sending' : 'send')}</span>
            </Button>
          </div>
        </div>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{tr('sendHint')}</p>
    </div>
  );
}
