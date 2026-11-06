import type { GalleryItem } from '@agent-sales/contracts';
import { ChevronLeft, ChevronRight, ExternalLink, Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

import { hostOf } from '../../lib/gallery-model';
import { videoLinkOf } from '../../lib/video-link';

/**
 * Large view of one folder item: the photo (or playable video, a YouTube/Drive player, or a link
 * card), its caption
 * editable in place, ‹ › and the arrow keys to step through the folder in its order.
 */
export function MediaViewer({
  items,
  labels,
  index,
  folderName,
  canEdit,
  onIndexChange,
  onClose,
  onCaptionChange,
}: {
  items: readonly GalleryItem[];
  labels: readonly string[];
  /** null = closed. */
  index: number | null;
  folderName: string;
  canEdit: boolean;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onCaptionChange: (index: number, caption: string) => void;
}) {
  const { t } = useTranslation('lodging');
  const item = index !== null ? items[index] : undefined;
  const count = items.length;
  const video = item?.kind === 'link' ? videoLinkOf(item.url) : null;
  const step = (by: number) => {
    if (index === null || count < 2) return;
    onIndexChange((index + by + count) % count);
  };
  return (
    <Dialog open={item !== undefined} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="gap-3 sm:max-w-4xl"
        onKeyDown={(e) => {
          // Arrow keys step through the folder unless the caption box is being typed in.
          if (e.target instanceof HTMLTextAreaElement) return;
          if (e.key === 'ArrowLeft') step(-1);
          if (e.key === 'ArrowRight') step(1);
        }}
      >
        {item && index !== null && (
          <>
            <div className="flex items-baseline gap-2 pr-8">
              <DialogTitle className="min-w-0 truncate">{labels[index]}</DialogTitle>
              <DialogDescription className="shrink-0 tabular-nums">
                {t('media.position', { n: index + 1, total: count })}
              </DialogDescription>
            </div>
            <div className="relative grid min-h-48 place-items-center overflow-hidden rounded-lg bg-muted">
              {item.kind === 'image' && (
                <img
                  src={item.url}
                  alt={labels[index]}
                  referrerPolicy="no-referrer"
                  className="max-h-[65vh] w-auto object-contain"
                />
              )}
              {item.kind === 'video' && (
                <video
                  key={item.url}
                  src={item.url}
                  controls
                  playsInline
                  aria-label={labels[index]}
                  className="max-h-[65vh] w-full bg-black"
                />
              )}
              {item.kind === 'link' && video && (
                // 16:9, never taller than the photos' 65vh.
                <div className="aspect-video w-full max-w-[calc(65vh*16/9)] bg-black">
                  <iframe
                    key={video.embed}
                    src={video.embed}
                    title={labels[index]}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                    className="size-full border-0"
                  />
                </div>
              )}
              {item.kind === 'link' && !video && (
                <div className="grid justify-items-center gap-3 p-8 text-center">
                  <Link2 className="size-8 text-muted-foreground" aria-hidden />
                  <p className="text-sm break-all">{item.url}</p>
                  <OpenLink url={item.url} />
                </div>
              )}
              {count > 1 && (
                <>
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    aria-label={t('media.previous')}
                    className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full"
                    onClick={() => step(-1)}
                  >
                    <ChevronLeft aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    aria-label={t('media.next')}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full"
                    onClick={() => step(1)}
                  >
                    <ChevronRight aria-hidden />
                  </Button>
                </>
              )}
            </div>
            {item.kind === 'link' && video && (
              <div className="flex min-w-0 items-center justify-between gap-3">
                <p className="min-w-0 truncate text-xs text-muted-foreground">{item.url}</p>
                <OpenLink url={item.url} />
              </div>
            )}
            {canEdit ? (
              <label className="grid gap-1.5 text-sm font-medium">
                {t('media.caption')}
                <Textarea
                  rows={2}
                  maxLength={300}
                  value={item.caption}
                  placeholder={folderName}
                  className="font-normal"
                  onChange={(e) => onCaptionChange(index, e.target.value)}
                />
              </label>
            ) : (
              <p className="text-sm">{item.caption || folderName}</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OpenLink({ url }: { url: string }) {
  const { t } = useTranslation('lodging');
  return (
    <Button asChild size="sm" variant="outline" className="shrink-0">
      <a href={url} target="_blank" rel="noopener noreferrer">
        <ExternalLink aria-hidden />
        {t('media.openLink', { host: hostOf(url) })}
      </a>
    </Button>
  );
}
