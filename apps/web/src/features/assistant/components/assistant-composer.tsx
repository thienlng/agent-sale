import { ASSISTANT_MESSAGE_MAX } from '@agent-sales/contracts';
import { Paperclip, SendHorizontal } from 'lucide-react';
import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useEnterToSend } from '@/hooks/use-enter-to-send';

import { useAssistantUi } from '../stores/assistant-ui.store';
import { ATTACH_ACCEPT, type AssistantAttachments, AttachmentTray } from './assistant-attachments';

/**
 * Message box: Enter sends, Shift+Enter or Alt+Enter adds a line. While a turn runs the owner can keep typing;
 * only sending waits (the send button is disabled and Enter does nothing; 📎 still attaches). `onSend`
 * resolves false when the message was not sent, and the text comes back for another try. A new
 * `draft` (a page's request that arrived while a turn ran) replaces the text for the owner to send.
 * With `attachments`, 📎 attaches a sheet or product photos (the tray shows them above the box),
 * and a message with a ready attachment may have no text.
 */
export function AssistantComposer({
  sending,
  onSend,
  draft = null,
  attachments,
  typed,
}: {
  sending: boolean;
  onSend: (text: string) => Promise<boolean>;
  draft?: { id: string; text: string } | null;
  attachments?: AssistantAttachments;
  /** Where the text is kept while this box remounts elsewhere (the sheet ↔ the full page). */
  typed?: { current: string };
}) {
  const { t } = useTranslation('assistant');
  const [text, setTextState] = useState(draft?.text ?? typed?.current ?? '');
  const setText = (next: string | ((current: string) => string)) =>
    setTextState((current) => {
      const value = typeof next === 'function' ? next(current) : next;
      if (typed) typed.current = value;
      return value;
    });
  const [draftId, setDraftId] = useState(draft?.id);
  if (draft && draft.id !== draftId) {
    setDraftId(draft.id);
    setText(draft.text);
  }
  const picker = useRef<HTMLInputElement>(null);
  const attached = attachments?.active ?? false;
  const canSend = !sending && (attached ? !attachments?.busy : Boolean(text.trim()));
  const input = useRef<HTMLTextAreaElement>(null);
  // A page opened the panel with a question ("Vì sao bot trả lời vậy?"): the owner reviews it.
  const launchDraft = useAssistantUi((s) => s.draft);
  useEffect(() => {
    if (launchDraft === null) return;
    const value = useAssistantUi.getState().takeDraft();
    if (value === null) return;
    setText(value);
    input.current?.focus();
  }, [launchDraft]);

  function submit(): void {
    const value = text.trim();
    if (!canSend) return;
    setText('');
    void onSend(value).then((sent) => {
      if (!sent) setText((current) => current || value);
    });
  }

  const enterToSend = useEnterToSend(input, submit);

  // A paste (or a draft) taller than the box: keep the caret in view when it sits at the end, the
  // box having just grown to its max height while the browser kept the old scroll position.
  useLayoutEffect(() => {
    const el = input.current;
    if (el && document.activeElement === el && el.selectionEnd === el.value.length) {
      el.scrollTop = el.scrollHeight;
    }
  }, [text]);

  return (
    <div className="flex flex-col">
      {attachments ? <AttachmentTray attachments={attachments} /> : null}
      <form
        data-measure
        // One box: the attach button, the text and the send button inside the same border. The
        // textarea is as tall as the 44px icon buttons, so one line of text sits on their centre.
        className="mx-3 mb-3 flex items-end gap-1 rounded-2xl border bg-background p-1.5 shadow-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          submit();
        }}
      >
        {attachments ? (
          <>
            <input
              ref={picker}
              type="file"
              className="hidden"
              accept={ATTACH_ACCEPT}
              multiple
              data-testid="assistant-file-input"
              onChange={(event) => {
                if (event.target.files) attachments.addFiles(event.target.files);
                // The same file can be picked again after a removal.
                event.target.value = '';
              }}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="text-muted-foreground"
              aria-label={t('import.attach')}
              disabled={attachments.creating}
              onClick={() => picker.current?.click()}
            >
              <Paperclip />
            </Button>
          </>
        ) : null}
        <Textarea
          ref={input}
          aria-label={t('placeholder')}
          placeholder={t('placeholder')}
          value={text}
          maxLength={ASSISTANT_MESSAGE_MAX}
          rows={1}
          className="max-h-40 min-h-11 resize-none border-0 bg-transparent px-2 py-3 shadow-none focus-visible:ring-0 dark:bg-transparent"
          onChange={(event) => setText(event.target.value)}
          {...enterToSend}
        />
        <Button
          type="submit"
          size="icon"
          aria-label={t('send')}
          disabled={!canSend}
          className="rounded-xl disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
        >
          <SendHorizontal />
        </Button>
      </form>
    </div>
  );
}
