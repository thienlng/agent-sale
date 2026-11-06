import type { BotReplyImage } from '@agent-sales/contracts';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ImageLightbox } from '@/components/image-lightbox';
import { cn } from '@/lib/utils';

import type { Attachment } from '../hooks/use-image-attachments';

/** Thumbnails of images in the composer (with remove) or in a sent customer bubble. */
export function AttachmentThumbs({
  items,
  onRemove,
}: {
  items: readonly Pick<Attachment, 'id' | 'url'>[];
  onRemove?: (id: number) => void;
}) {
  const { t } = useTranslation();
  if (!items.length) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((a) => (
        <li key={a.id} className="relative">
          <img
            src={a.url}
            alt={t('playground.imageAttached')}
            className="size-16 rounded-lg border object-cover"
          />
          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(a.id)}
              aria-label={t('playground.removeImage')}
              className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <X className="size-3" aria-hidden />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function BotImage({ image, onOpen }: { image: BotReplyImage; onOpen: () => void }) {
  const { t } = useTranslation();
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('lightbox.open', { label: image.label })}
      className="relative aspect-square overflow-hidden rounded-md border bg-muted focus-visible:outline-2 focus-visible:outline-ring"
    >
      {broken ? (
        <span className="grid size-full place-items-center p-1.5 text-center text-[11px] leading-tight text-muted-foreground">
          {image.label}
        </span>
      ) : (
        <img
          src={image.url}
          alt={image.label}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="size-full cursor-zoom-in object-cover"
        />
      )}
    </button>
  );
}

/** Pictures the bot sends after its text: an album grid; a click opens the large view. */
export function BotImages({ images }: { images: readonly BotReplyImage[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!images.length) return null;
  const cols =
    images.length === 1
      ? 'grid-cols-1 max-w-44'
      : images.length === 2 || images.length === 4
        ? 'grid-cols-2 max-w-60'
        : 'grid-cols-3 max-w-64';
  return (
    <>
      <div className={cn('grid gap-1', cols)}>
        {images.map((image, i) => (
          <BotImage key={image.url} image={image} onOpen={() => setOpen(i)} />
        ))}
      </div>
      <ImageLightbox
        images={images}
        index={open}
        onIndexChange={setOpen}
        onClose={() => setOpen(null)}
      />
    </>
  );
}

/** Videos the bot sends, each as its own message (lodging folders, T-192). */
export function BotVideos({ videos }: { videos: readonly { url: string; label: string }[] }) {
  if (!videos.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {videos.map((video) => (
        <video
          key={video.url}
          src={video.url}
          controls
          preload="metadata"
          aria-label={video.label}
          className="max-h-64 w-full max-w-xs rounded-lg border bg-muted"
        />
      ))}
    </div>
  );
}
