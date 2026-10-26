import { ImagePlus, SendHorizontal } from 'lucide-react';
import { type ClipboardEvent, type DragEvent, type FormEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

import {
  type AttachError,
  type Attachment,
  IMAGE_TYPES,
  MAX_IMAGES,
} from '../hooks/use-image-attachments';
import { AttachmentThumbs } from './test-chat-images';

export function TestChatComposer({
  draft,
  onDraft,
  attachments,
  attachError,
  onAddFiles,
  onRemoveFile,
  onSend,
  busy,
}: {
  draft: string;
  onDraft: (value: string) => void;
  attachments: readonly Attachment[];
  attachError: AttachError | null;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: number) => void;
  onSend: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const { t: training } = useTranslation('training');
  const fileInput = useRef<HTMLInputElement>(null);
  const canSend = (!!draft.trim() || attachments.length > 0) && !busy;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canSend) onSend();
  };
  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      onAddFiles(files);
    }
  };
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    onAddFiles([...e.dataTransfer.files]);
  };

  return (
    <form
      onSubmit={submit}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      className="border-t p-3"
    >
      {attachError ? (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {t(`playground.imageError.${attachError}`, { max: MAX_IMAGES })}
        </p>
      ) : null}
      {attachments.length ? (
        <div className="mb-2">
          <AttachmentThumbs items={attachments} onRemove={onRemoveFile} />
        </div>
      ) : null}
      <div className="flex items-end gap-2 rounded-2xl border bg-background p-1.5 pl-1.5 focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/15">
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          multiple
          hidden
          data-testid="test-chat-file"
          onChange={(e) => {
            onAddFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="rounded-xl"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          aria-label={t('playground.attachImage')}
          title={t('playground.attachImage')}
        >
          <ImagePlus />
        </Button>
        <Textarea
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          onPaste={onPaste}
          rows={1}
          maxLength={2000}
          placeholder={training('space.chat.placeholder')}
          aria-label={training('space.chat.placeholder')}
          className="max-h-32 min-h-9 resize-none border-0 bg-transparent px-0 py-2 text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <Button
          type="submit"
          size="icon-lg"
          className="rounded-xl"
          disabled={!canSend}
          aria-label={t('playground.send')}
        >
          <SendHorizontal />
        </Button>
      </div>
    </form>
  );
}
