import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { ImageUploadZone } from './image-upload-zone';

export const MAX_GALLERY_PHOTOS = 30;

export interface GalleryPhoto {
  url: string;
  caption: string;
}

/** Property photos uploaded from the device; every photo needs a caption before saving. */
export function LodgingGalleryEditor({
  value,
  onChange,
}: {
  value: GalleryPhoto[];
  onChange: (gallery: GalleryPhoto[]) => void;
}) {
  const { t } = useTranslation();
  // Uploads finish later: append to what the user has now, not to what they had at the start.
  const latest = useRef(value);
  latest.current = value;
  return (
    <fieldset className="space-y-3">
      <legend className="font-semibold">
        {t('lodging.gallery')} · {value.length}/{MAX_GALLERY_PHOTOS}
      </legend>
      {value.map((photo, i) => (
        <div key={`${photo.url}#${i}`} className="flex gap-3 rounded-lg border p-3">
          <img
            src={photo.url}
            alt={t('lodging.photoAlt', { n: i + 1 })}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="size-20 shrink-0 rounded-md border object-cover"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <Input
              aria-label={`${t('lodging.caption')} ${i + 1}`}
              value={photo.caption}
              maxLength={300}
              placeholder={t('lodging.caption')}
              onChange={(e) =>
                onChange(value.map((v, j) => (i === j ? { ...v, caption: e.target.value } : v)))
              }
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() => onChange(value.filter((_, j) => i !== j))}
            >
              {t('lodging.remove')}
            </Button>
          </div>
        </div>
      ))}
      <ImageUploadZone
        remaining={MAX_GALLERY_PHOTOS - value.length}
        onUploaded={(urls) =>
          onChange(
            [...latest.current, ...urls.map((url) => ({ url, caption: '' }))].slice(
              0,
              MAX_GALLERY_PHOTOS,
            ),
          )
        }
      />
    </fieldset>
  );
}
