import type { GalleryItem } from '@agent-sales/contracts';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Link2, MoreVertical, Play } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { hostOf } from '../../lib/gallery-model';
import { type VideoLink, videoLinkOf } from '../../lib/video-link';

/** Every tile badge: one text size and line height. */
const BADGE = 'inline-flex items-center rounded px-1.5 text-xs leading-5 tabular-nums';

export const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** A video link's provider name (a brand, the same in every language). */
const PROVIDER_LABEL = { youtube: 'YouTube', drive: 'Google Drive' } as const;

/** What a link is in the list view: its provider ("YouTube", "Google Drive") or "Link". */
export function linkKind(url: string, linkBadge: string): string {
  const video = videoLinkOf(url);
  return video ? PROVIDER_LABEL[video.provider] : linkBadge;
}

/** The round play mark over a video link's picture. */
function PlayMark({ small }: { small: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute top-1/2 left-1/2 grid -translate-1/2 place-items-center rounded-full bg-black/70 text-white',
        small ? 'size-6' : 'size-11',
      )}
    >
      <Play className={cn('fill-current', small ? 'size-3' : 'size-5')} />
    </span>
  );
}

/**
 * A YouTube or Drive link as a video: the YouTube thumbnail (or a dark Drive placeholder) with a
 * play mark; on a grid tile also its title and the provider ("YouTube", "Google Drive"). `compact` (the list's thumbnail) shows no text.
 */
function VideoLinkPreview({
  item,
  video,
  label,
  compact,
}: {
  item: GalleryItem;
  video: VideoLink;
  label: string;
  compact: boolean;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-neutral-900 text-white">
      {video.provider === 'youtube' ? (
        <img
          src={video.thumbnail}
          alt={label}
          loading="lazy"
          referrerPolicy="no-referrer"
          // hqdefault is 4:3 with black bars above and below a 16:9 video: zoom them away.
          className="absolute inset-0 size-full scale-[1.34] object-cover"
        />
      ) : null}
      <PlayMark small={compact} />
      {!compact && (
        <div className="absolute inset-x-0 bottom-0 grid bg-linear-to-t from-black/80 to-transparent px-2 pt-6 pb-1.5 text-xs">
          {item.caption && <span className="truncate font-medium">{item.caption}</span>}
          <span className="truncate text-white/80">{PROVIDER_LABEL[video.provider]}</span>
        </div>
      )}
    </div>
  );
}

export function Preview({
  item,
  label,
  compact = false,
}: {
  item: GalleryItem;
  label: string;
  /** The list view's small thumbnail: pictures only, no text. */
  compact?: boolean;
}) {
  const [seconds, setSeconds] = useState<number | null>(null);
  if (item.kind === 'image')
    return (
      <img
        src={item.url}
        alt={label}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="absolute inset-0 size-full object-cover"
      />
    );
  if (item.kind === 'video')
    return (
      <>
        <video
          src={item.url}
          preload="metadata"
          muted
          playsInline
          aria-label={label}
          className="absolute inset-0 size-full object-cover"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setSeconds(d);
          }}
        />
        <span className={cn(BADGE, 'absolute right-1 bottom-1 gap-1 bg-background/90')}>
          <Play className="size-3" aria-hidden />
          {seconds !== null ? clock(seconds) : null}
        </span>
      </>
    );
  const video = videoLinkOf(item.url);
  if (video) return <VideoLinkPreview item={item} video={video} label={label} compact={compact} />;
  return (
    <div className="absolute inset-0 grid place-content-center justify-items-center gap-1 p-2 text-center text-xs text-muted-foreground">
      <Link2 className="size-6" aria-hidden />
      <span className="line-clamp-2 break-all">{item.caption || hostOf(item.url)}</span>
      <span className="truncate">{hostOf(item.url)}</span>
    </div>
  );
}

export interface ItemMenuProps {
  label: string;
  first: boolean;
  last: boolean;
  canMove: boolean;
  /** False only for the cover the owner already chose; the automatic cover can be pinned. */
  canSetCover: boolean;
  onUp: () => void;
  onDown: () => void;
  onMove: () => void;
  onCover: () => void;
  onCaption: () => void;
  onRemove: () => void;
}

/** The ⋮ menu of one item, shared by the grid tile and the list row. */
export function ItemMenu({
  label,
  first,
  last,
  canMove,
  canSetCover,
  onUp,
  onDown,
  onMove,
  onCover,
  onCaption,
  onRemove,
}: ItemMenuProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          aria-label={t('lodging.media.itemMenu', { label })}
        >
          <MoreVertical aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={first} onSelect={onUp}>
          {t('lodging.media.up')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={last} onSelect={onDown}>
          {t('lodging.media.down')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canMove} onSelect={onMove}>
          {t('lodging.media.moveTo')}
        </DropdownMenuItem>
        {canSetCover && (
          <DropdownMenuItem onSelect={onCover}>{t('lodging.media.setCover')}</DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onCaption}>{t('lodging.media.editCaption')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onRemove}>
          {t('lodging.media.remove')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One sortable tile of the folder grid: its number (photos), badges, selection and ⋮ menu. */
export function MediaTile({
  id,
  item,
  label,
  number,
  early,
  showEarlyLabel,
  isCover,
  canSetCover,
  canEdit,
  selected,
  first,
  last,
  canMove,
  onSelect,
  onUp,
  onDown,
  onMove,
  onCover,
  onCaption,
  onRemove,
  onOpen,
}: {
  id: string;
  item: GalleryItem;
  label: string;
  number: number | null;
  early: boolean;
  showEarlyLabel: boolean;
  isCover: boolean;
  /** False only for the cover the owner already chose; the automatic cover can be pinned. */
  canSetCover: boolean;
  canEdit: boolean;
  selected: boolean;
  first: boolean;
  last: boolean;
  canMove: boolean;
  onSelect: (selected: boolean) => void;
  onUp: () => void;
  onDown: () => void;
  onMove: () => void;
  onCover: () => void;
  onCaption: () => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !canEdit,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid="media-tile"
      data-early={early || undefined}
      className={cn(
        'group relative aspect-square overflow-hidden rounded-lg border bg-muted',
        early && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
        isDragging && 'z-10 opacity-80 shadow-lg',
      )}
    >
      <Preview item={item} label={label} />
      {/* The whole tile opens the large view; the top bar's controls sit above this button. */}
      <button
        type="button"
        aria-label={t('lodging.media.view', { label })}
        title={item.caption || undefined}
        className="absolute inset-0 cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
        onClick={onOpen}
      />
      {/* One top bar: the number badge and the controls share a 28px row and one centre line. */}
      <div className="pointer-events-none absolute inset-x-1 top-1 flex items-center justify-between gap-1 *:pointer-events-auto">
        <span
          className={cn(
            BADGE,
            'h-7 min-w-7 justify-center overflow-hidden rounded-[min(var(--radius-md),12px)] bg-background/90 font-semibold',
          )}
        >
          {/* A long provider name ("Google Drive") ends in "…" on a narrow phone tile. */}
          <span className="truncate">
            {number ??
              (item.kind === 'video' || videoLinkOf(item.url)
                ? t('lodging.media.videoBadge')
                : t('lodging.media.linkBadge'))}
          </span>
        </span>
        {canEdit && (
          <div className="flex items-center gap-1">
            <span
              className={cn(
                'grid size-7 place-items-center rounded-[min(var(--radius-md),12px)] bg-background/90',
                !selected &&
                  'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100',
              )}
            >
              <Checkbox
                aria-label={t('lodging.media.select', { label })}
                checked={selected}
                onCheckedChange={(v) => onSelect(v === true)}
                className="bg-background"
              />
            </span>
            <Button
              type="button"
              size="icon-sm"
              variant="secondary"
              aria-label={t('lodging.media.dragHandle', { label })}
              className="cursor-grab touch-none active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical aria-hidden />
            </Button>
            <ItemMenu
              label={label}
              first={first}
              last={last}
              canMove={canMove}
              canSetCover={canSetCover}
              onUp={onUp}
              onDown={onDown}
              onMove={onMove}
              onCover={onCover}
              onCaption={onCaption}
              onRemove={onRemove}
            />
          </div>
        )}
      </div>
      {(showEarlyLabel || isCover) && (
        // Stacked from the bottom so the two labels never overlap on narrow phone tiles.
        <div className="pointer-events-none absolute inset-x-1 bottom-1 flex flex-col items-start gap-1">
          {showEarlyLabel && (
            <span className={cn(BADGE, 'bg-primary font-medium text-primary-foreground')}>
              {t('lodging.media.botFirst')}
            </span>
          )}
          {isCover && (
            <span className={cn(BADGE, 'bg-background/90')}>{t('lodging.media.coverTitle')}</span>
          )}
        </div>
      )}
    </li>
  );
}
