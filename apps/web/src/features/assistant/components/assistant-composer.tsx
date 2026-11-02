import { Paperclip, SendHorizontal } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

import { ATTACH_ACCEPT, type AssistantAttachments, AttachmentTray } from './assistant-attachments';

/**
 * Message box: Enter sends, Shift+Enter adds a line, disabled while a turn runs. `onSend`
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
}: {
  sending: boolean;
  onSend: (text: string) => Promise<boolean>;
  draft?: { id: string; text: string } | null;
  attachments?: AssistantAttachments;
}) {
  const { t } = useTranslation('assistant');
  const [text, setText] = useState(draft?.text ?? '');
  const [draftId, setDraftId] = useState(draft?.id);
  if (draft && draft.id !== draftId) {
    setDraftId(draft.id);
    setText(draft.text);
  }
  const picker = useRef<HTMLInputElement>(null);
  const attached = attachments?.active ?? false;
  const canSend = !sending && (attached ? !attachments?.busy : Boolean(text.trim()));

  function submit(): void {
    const value = text.trim();
    if (!canSend) return;
    setText('');
    void onSend(value).then((sent) => {
      if (!sent) setText((current) => current || value);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // A Vietnamese IME confirms its word with Enter: never send mid-composition.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  return (
    <div className="flex flex-col">
      {attachments ? <AttachmentTray attachments={attachments} /> : null}
      <form
        className="flex items-end gap-2 border-t p-3"
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
              size="icon-lg"
              variant="ghost"
              aria-label={t('import.attach')}
              disabled={sending || attachments.creating}
              onClick={() => picker.current?.click()}
            >
              <Paperclip />
            </Button>
          </>
        ) : null}
        <Textarea
          aria-label={t('placeholder')}
          placeholder={t('placeholder')}
          value={text}
          disabled={sending}
          maxLength={4000}
          rows={1}
          className="max-h-40 min-h-10 resize-none"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button type="submit" size="icon-lg" aria-label={t('send')} disabled={!canSend}>
          <SendHorizontal />
        </Button>
      </form>
    </div>
  );
}
