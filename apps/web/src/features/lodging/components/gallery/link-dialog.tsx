import { type GalleryItem, PublicHttpsUrl } from '@agent-sales/contracts';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { normalizeLinkInput } from '../../lib/video-link';

/**
 * "Thêm link video": a video link (YouTube, Drive, TikTok…) and an optional title. A pasted
 * `youtu.be/…` or `http://…` link is stored as https (the contract only takes https links).
 */
export function LinkDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (item: GalleryItem) => void;
}) {
  const { t } = useTranslation('lodging');
  const id = useId();
  const [url, setUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open) {
      setUrl('');
      setCaption('');
      setTried(false);
    }
  }, [open]);
  const link = normalizeLinkInput(url);
  const valid = link !== null && PublicHttpsUrl.safeParse(link).success;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTried(true);
    if (!valid || link === null) return;
    onAdd({ kind: 'link', url: link, caption: caption.trim() });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <form noValidate onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t('media.addLink')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-url`}>{t('media.linkUrl')}</Label>
            <Input
              id={`${id}-url`}
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={url}
              maxLength={2000}
              placeholder="youtu.be/… · drive.google.com/…"
              aria-invalid={tried && !valid ? true : undefined}
              aria-describedby={tried && !valid ? `${id}-url-error` : undefined}
              onChange={(e) => setUrl(e.target.value)}
            />
            {tried && !valid && (
              <p id={`${id}-url-error`} className="text-xs text-destructive">
                {t('media.linkUrlInvalid')}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-caption`}>{t('media.linkCaption')}</Label>
            <Input
              id={`${id}-caption`}
              value={caption}
              maxLength={300}
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit">{t('media.linkAdd')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
