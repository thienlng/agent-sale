import type { BotReplyImage } from '@agent-sales/contracts';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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

function BotImage({ image }: { image: BotReplyImage }) {
  const [broken, setBroken] = useState(false);
  return (
    <a
      href={image.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-primary underline-offset-2 hover:underline"
    >
      {broken ? (
        image.label
      ) : (
        <img
          src={image.url}
          alt={image.label}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="size-24 rounded-lg border object-cover"
        />
      )}
    </a>
  );
}

/** Pictures the bot sends after its text. */
export function BotImages({ images }: { images: readonly BotReplyImage[] }) {
  if (!images.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((image) => (
        <BotImage key={image.url} image={image} />
      ))}
    </div>
  );
}
