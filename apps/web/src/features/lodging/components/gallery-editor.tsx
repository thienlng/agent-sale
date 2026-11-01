import { ArrowUp, Trash2 } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const MAX_GALLERY_PHOTOS = 30;

export interface GalleryPhoto {
  url: string;
  caption: string;
}

/**
 * The upload control, passed in by the route (image upload belongs to another feature):
 * it receives how many photos may still be added and reports the uploaded URLs.
 */
export type GalleryUploadSlot = (props: {
  remaining: number;
  onUploaded: (urls: string[]) => void;
}) => ReactNode;

/** Captioned property photos; the first photo is the cover. Every photo needs a caption. */
export function GalleryEditor({
  value,
  onChange,
  disabled = false,
  showErrors = false,
  renderUpload,
}: {
  value: GalleryPhoto[];
  onChange: (gallery: GalleryPhoto[]) => void;
  disabled?: boolean;
  showErrors?: boolean;
  renderUpload?: GalleryUploadSlot | undefined;
}) {
  const { t } = useTranslation();
  // Uploads finish later: append to what the user has now, not to what they had at the start.
  const latest = useRef(value);
  latest.current = value;
  const move = (i: number) =>
    onChange(
      value.map((v, j) => (j === i - 1 ? value[i] : j === i ? value[i - 1] : v) as GalleryPhoto),
    );
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground tabular-nums">
        {t('lodging.photos.count', { count: value.length, max: MAX_GALLERY_PHOTOS })}
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {value.map((photo, i) => {
          const missing = showErrors && !photo.caption.trim();
          const errorId = `gallery-caption-${i}-error`;
          return (
            <li key={`${photo.url}#${i}`} className="flex gap-3 rounded-lg border p-3">
              <img
                src={photo.url}
                alt={t('lodging.photos.alt', { n: i + 1 })}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="size-20 shrink-0 rounded-md border object-cover"
              />
              <div className="grid min-w-0 flex-1 content-start gap-2">
                {i === 0 && (
                  <Badge variant="secondary" className="justify-self-start">
                    {t('lodging.photos.cover')}
                  </Badge>
                )}
                <Input
                  aria-label={t('lodging.photos.caption', { n: i + 1 })}
                  value={photo.caption}
                  maxLength={300}
                  disabled={disabled}
                  placeholder={t('lodging.photos.caption', { n: i + 1 })}
                  aria-invalid={missing || undefined}
                  aria-describedby={missing ? errorId : undefined}
                  onChange={(e) =>
                    onChange(value.map((v, j) => (i === j ? { ...v, caption: e.target.value } : v)))
                  }
                />
                {missing && (
                  <p id={errorId} className="text-xs text-destructive">
                    {t('lodging.photos.captionRequired')}
                  </p>
                )}
                {!disabled && (
                  <div className="flex gap-1">
                    {i > 0 && (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('lodging.photos.moveUp', { n: i + 1 })}
                        onClick={() => move(i)}
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('lodging.photos.remove', { n: i + 1 })}
                      onClick={() => onChange(value.filter((_, j) => i !== j))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!disabled &&
        renderUpload?.({
          remaining: MAX_GALLERY_PHOTOS - value.length,
          onUploaded: (urls) =>
            onChange(
              [...latest.current, ...urls.map((url) => ({ url, caption: '' }))].slice(
                0,
                MAX_GALLERY_PHOTOS,
              ),
            ),
        })}
    </div>
  );
}
