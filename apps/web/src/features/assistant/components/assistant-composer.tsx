import { SendHorizontal } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/**
 * Message box: Enter sends, Shift+Enter adds a line, disabled while a turn runs. `onSend`
 * resolves false when the message was not sent, and the text comes back for another try.
 */
export function AssistantComposer({
  sending,
  onSend,
}: {
  sending: boolean;
  onSend: (text: string) => Promise<boolean>;
}) {
  const { t } = useTranslation('assistant');
  const [text, setText] = useState('');

  function submit(): void {
    const value = text.trim();
    if (!value || sending) return;
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
    <form
      className="flex items-end gap-2 border-t p-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        submit();
      }}
    >
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
      <Button
        type="submit"
        size="icon-lg"
        aria-label={t('send')}
        disabled={sending || !text.trim()}
      >
        <SendHorizontal />
      </Button>
    </form>
  );
}
