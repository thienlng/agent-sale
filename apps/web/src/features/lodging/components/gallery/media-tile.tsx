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

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function Preview({ item, label }: { item: GalleryItem; label: string }) {
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
        <span className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded bg-background/90 px-1.5 text-xs tabular-nums">
          <Play className="size-3" aria-hidden />
          {seconds !== null ? clock(seconds) : null}
        </span>
      </>
    );
  return (
    <div className="absolute inset-0 grid place-content-center justify-items-center gap-1 p-2 text-center text-xs text-muted-foreground">
      <Link2 className="size-6" aria-hidden />
      <span className="line-clamp-2 break-all">{item.caption || hostOf(item.url)}</span>
      <span className="truncate">{hostOf(item.url)}</span>
    </div>
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
      <span className="absolute top-1.5 left-1.5 rounded bg-background/90 px-1.5 text-xs font-semibold tabular-nums">
        {number !== null
          ? number
          : item.kind === 'video'
            ? t('lodging.media.videoBadge')
            : t('lodging.media.linkBadge')}
      </span>
      {showEarlyLabel && (
        <span className="absolute bottom-1.5 left-1.5 rounded bg-primary px-1.5 text-[11px] font-medium text-primary-foreground">
          {t('lodging.media.botFirst')}
        </span>
      )}
      {isCover && (
        <span className="absolute right-1.5 bottom-1.5 rounded bg-background/90 px-1.5 text-[11px]">
          {t('lodging.media.coverTitle')}
        </span>
      )}
      {canEdit && (
        <div className="absolute top-1 right-1 flex items-center gap-0.5">
          <Checkbox
            aria-label={t('lodging.media.select', { label })}
            checked={selected}
            onCheckedChange={(v) => onSelect(v === true)}
            className={cn(
              'bg-background',
              !selected &&
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100',
            )}
          />
          <button
            type="button"
            aria-label={t('lodging.media.dragHandle', { label })}
            className="grid size-7 cursor-grab touch-none place-items-center rounded bg-background/90"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
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
                <DropdownMenuItem onSelect={onCover}>
                  {t('lodging.media.setCover')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onCaption}>
                {t('lodging.media.editCaption')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                {t('lodging.media.remove')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </li>
  );
}
