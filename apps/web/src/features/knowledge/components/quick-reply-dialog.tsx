import type { TrainingItemDto } from '@agent-sales/contracts';
import { Check, ImageOff, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

import { useSaveTrainingItem } from '../api/training';
import { isValidShortcut, MAX_SHORTCUT_LENGTH, normalizeShortcut } from '../utils/quick-replies';

/** Thumbnails of the bot's image library; clicking one selects its URL. */
function LibraryPicker({
  images,
  value,
  onPick,
}: {
  images: TrainingItemDto[];
  value: string;
  onPick: (url: string) => void;
}) {
  const { t } = useTranslation('training');
  if (!images.length)
    return <p className="text-sm text-muted-foreground">{t('data.quick.libraryEmpty')}</p>;
  return (
    <ul className="grid max-h-44 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
      {images.map((image) => {
        const active = image.mediaUrl === value;
        return (
          <li key={image.id}>
            <button
              type="button"
              aria-pressed={active}
              aria-label={image.title}
              title={image.title}
              onClick={() => onPick(image.mediaUrl ?? '')}
              className={cn(
                'relative block aspect-square w-full overflow-hidden rounded-lg border bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                active && 'border-primary ring-2 ring-primary',
              )}
            >
              <img src={image.mediaUrl ?? ''} alt="" className="size-full object-cover" />
              {active ? (
                <Check className="absolute top-1 right-1 size-4 rounded-full bg-primary p-0.5 text-primary-foreground" />
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Add (item = null) or edit a quick reply: shortcut, content and an optional image. */
export function QuickReplyDialog({
  botId,
  item,
  images,
  onClose,
}: {
  botId: string;
  item: TrainingItemDto | null;
  images: TrainingItemDto[];
  onClose: () => void;
}) {
  const { t } = useTranslation('training');
  const { t: common } = useTranslation();
  const save = useSaveTrainingItem(botId);
  const [shortcut, setShortcut] = useState(normalizeShortcut(item?.trigger || item?.title || ''));
  const [content, setContent] = useState(item?.content ?? '');
  const [mediaUrl, setMediaUrl] = useState(item?.mediaUrl ?? '');
  const [touched, setTouched] = useState(false);
  const key = normalizeShortcut(shortcut);
  const shortcutOk = isValidShortcut(key);
  const url = mediaUrl.trim();
  const urlOk = !url || /^https:\/\/\S+$/.test(url);

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!shortcutOk || !urlOk || !content.trim()) return;
    save.mutate(
      {
        ...(item ? { id: item.id } : {}),
        kind: 'quick_reply',
        title: key,
        trigger: key,
        content: content.trim(),
        mediaUrl: url || null,
        folderId: null,
      },
      {
        onSuccess: () => {
          toast.success(t('data.quick.saved'));
          onClose();
        },
        onError: (error) => toast.error(errorMessage(common, error)),
      },
    );
  }

  return (
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{t(item ? 'data.quick.editTitle' : 'data.quick.addTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="quick-shortcut">{t('data.quick.shortcut')}</Label>
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
            >
              /
            </span>
            <Input
              id="quick-shortcut"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value.replace(/\s/g, ''))}
              maxLength={MAX_SHORTCUT_LENGTH + 1}
              aria-invalid={touched && !shortcutOk}
              aria-describedby="quick-shortcut-hint"
              className="pl-6"
              autoFocus
              required
            />
          </div>
          <p
            id="quick-shortcut-hint"
            className={cn(
              'text-xs text-muted-foreground',
              touched && !shortcutOk && 'text-destructive',
            )}
          >
            {touched && !shortcutOk
              ? t('data.quick.shortcutInvalid')
              : t('data.quick.shortcutHint', { shortcut: key || 'abc' })}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="quick-content">{t('data.quick.content')}</Label>
          <Textarea
            id="quick-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={8000}
            rows={5}
            aria-invalid={touched && !content.trim()}
            required
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('data.quick.image')}</legend>
          <p className="text-xs text-muted-foreground">{t('data.quick.pickFromLibrary')}</p>
          <LibraryPicker images={images} value={url} onPick={setMediaUrl} />
          <Label
            htmlFor="quick-image-url"
            className="pt-1 text-xs font-normal text-muted-foreground"
          >
            {t('data.quick.imageUrl')}
          </Label>
          <div className="flex gap-2">
            <Input
              id="quick-image-url"
              type="url"
              inputMode="url"
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              placeholder="https://"
              maxLength={2000}
              aria-invalid={!urlOk}
            />
            {url ? (
              <Button
                type="button"
                variant="outline"
                size="icon-lg"
                aria-label={t('data.quick.removeImage')}
                onClick={() => setMediaUrl('')}
              >
                <X />
              </Button>
            ) : null}
          </div>
          {!urlOk ? (
            <p className="flex items-center gap-1 text-xs text-destructive">
              <ImageOff className="size-3.5" aria-hidden />
              {t('data.quick.imageInvalid')}
            </p>
          ) : null}
        </fieldset>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('data.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t('data.save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
