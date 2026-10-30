import { ImagePlus, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { imageUploadErrorKey, useUploadProductImage } from '../api/commerce';
import { ImageUnreadableError, resizeImage } from '../lib/resize-image';

const ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * Drop zone + "choose images" button. Each file is shrunk in the browser and uploaded one after
 * another; `onUploaded` receives the URLs that made it (also when a later file fails).
 */
export function ImageUploadZone({
  remaining,
  onUploaded,
  inputId,
}: {
  remaining: number;
  onUploaded: (urls: string[]) => void;
  inputId: string;
}) {
  const { t } = useTranslation();
  const upload = useUploadProductImage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const disabled = busy || remaining <= 0;

  async function handle(files: File[]) {
    if (!files.length || remaining <= 0) return;
    if (files.length > remaining) toast.warning(t('products.form.imageTooMany', { n: remaining }));
    setBusy(true);
    const urls: string[] = [];
    try {
      for (const file of files.slice(0, remaining)) {
        try {
          const image = await resizeImage(file);
          urls.push(await upload.mutateAsync(image));
        } catch (error) {
          toast.error(
            error instanceof ImageUnreadableError
              ? t('products.form.imageUnreadable')
              : t(imageUploadErrorKey(error)),
          );
          if (!(error instanceof ImageUnreadableError)) break;
        }
      }
    } finally {
      setBusy(false);
      if (urls.length) onUploaded(urls);
    }
  }

  return (
    <div
      className={cn(
        'mt-4 flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground',
        dragging && 'border-primary bg-accent',
      )}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled) void handle(Array.from(e.dataTransfer.files));
      }}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        data-testid="image-file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void handle(files);
        }}
      />
      {busy ? (
        <p role="status" className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t('products.form.uploadingImages')}
        </p>
      ) : (
        <p>{t('products.form.dropImages')}</p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus />
        {t('products.form.pickImages')}
      </Button>
    </div>
  );
}
