import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export interface LightboxImage {
  url: string;
  label: string;
}

/** Swipes shorter than this (px) are taps, not page turns. */
const SWIPE_MIN = 40;

/**
 * Large view of a set of pictures in a popup: ‹ ›, the arrow keys and a horizontal swipe step
 * through them (wrapping around), with the picture's label and "n / total".
 */
export function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: readonly LightboxImage[];
  /** null = closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const startX = useRef<number | null>(null);
  const image = index !== null ? images[index] : undefined;
  const count = images.length;
  const step = (by: number) => {
    if (index === null || count < 2) return;
    onIndexChange((index + by + count) % count);
  };
  return (
    <Dialog open={image !== undefined} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="gap-3 sm:max-w-3xl"
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') step(-1);
          if (e.key === 'ArrowRight') step(1);
        }}
      >
        {image && index !== null && (
          <>
            <div className="flex items-baseline gap-2 pr-8">
              <DialogTitle className="min-w-0 truncate text-base">{image.label}</DialogTitle>
              <DialogDescription className="shrink-0 tabular-nums">
                {t('lightbox.position', { n: index + 1, total: count })}
              </DialogDescription>
            </div>
            <div
              className="relative grid min-h-48 touch-pan-y place-items-center overflow-hidden rounded-lg bg-muted select-none"
              onPointerDown={(e) => {
                startX.current = e.clientX;
              }}
              onPointerUp={(e) => {
                if (startX.current === null) return;
                const dx = e.clientX - startX.current;
                startX.current = null;
                if (Math.abs(dx) >= SWIPE_MIN) step(dx < 0 ? 1 : -1);
              }}
              onPointerCancel={() => {
                startX.current = null;
              }}
            >
              <img
                key={image.url}
                src={image.url}
                alt={image.label}
                draggable={false}
                referrerPolicy="no-referrer"
                className="max-h-[70vh] w-auto object-contain"
              />
              {count > 1 && (
                <>
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    aria-label={t('lightbox.previous')}
                    className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full shadow"
                    onClick={() => step(-1)}
                  >
                    <ChevronLeft aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    aria-label={t('lightbox.next')}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full shadow"
                    onClick={() => step(1)}
                  >
                    <ChevronRight aria-hidden />
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
