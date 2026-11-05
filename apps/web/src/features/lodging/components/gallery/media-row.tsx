import type { GalleryItem } from '@agent-sales/contracts';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { hostOf } from '../../lib/gallery-model';
import { ItemMenu, type ItemMenuProps, linkKind, Preview } from './media-tile';

const numberClass = (early: boolean) =>
  cn(
    'shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums',
    early ? 'bg-primary text-primary-foreground' : 'bg-muted',
  );

/**
 * One sortable row of the folder's list view: handle, number, thumbnail (opens the large
 * view), the caption edited in place, kind and badges, selection and the shared ⋮ menu.
 */
export function MediaRow({
  id,
  item,
  label,
  number,
  early,
  isCover,
  canEdit,
  selected,
  folderName,
  onSelect,
  onOpen,
  onCaptionChange,
  ...menu
}: Omit<ItemMenuProps, 'label'> & {
  id: string;
  item: GalleryItem;
  label: string;
  number: number | null;
  early: boolean;
  isCover: boolean;
  canEdit: boolean;
  selected: boolean;
  folderName: string;
  onSelect: (selected: boolean) => void;
  onOpen: () => void;
  onCaptionChange: (caption: string) => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !canEdit,
  });
  const kind =
    item.kind === 'image'
      ? t('lodging.media.number', { n: number ?? 0 })
      : item.kind === 'video'
        ? t('lodging.media.videoBadge')
        : `${linkKind(item.url, t('lodging.media.linkBadge'))} · ${hostOf(item.url)}`;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid="media-row"
      data-early={early || undefined}
      className={cn(
        'flex items-center gap-2 bg-background p-2 sm:gap-3',
        isDragging && 'relative z-10 shadow-lg',
      )}
    >
      {canEdit && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t('lodging.media.dragHandle', { label })}
          className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden />
        </Button>
      )}
      {/* sm+: the number has its own column; phones overlay it on the thumbnail to save width. */}
      <span className={cn(numberClass(early), 'hidden h-7 w-8 sm:inline-flex')}>
        {number ?? '–'}
      </span>
      <button
        type="button"
        aria-label={t('lodging.media.view', { label })}
        className="relative size-12 shrink-0 cursor-zoom-in overflow-hidden rounded-md border bg-muted focus-visible:outline-2 focus-visible:outline-ring sm:size-14"
        onClick={onOpen}
      >
        <Preview item={item} label={label} compact />
        <span
          className={cn(
            numberClass(early),
            'absolute top-0.5 left-0.5 inline-flex h-5 min-w-5 px-1 sm:hidden',
          )}
          aria-hidden
        >
          {number ?? '–'}
        </span>
      </button>
      <div className="grid min-w-0 flex-1 gap-1">
        {canEdit ? (
          <Input
            aria-label={t('lodging.media.captionOf', { label })}
            value={item.caption}
            maxLength={300}
            placeholder={folderName}
            className="h-8"
            onChange={(e) => onCaptionChange(e.target.value)}
          />
        ) : (
          <p className="truncate text-sm">{item.caption || folderName}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{kind}</span>
          {early && number === 1 && (
            <span className="rounded bg-primary px-1.5 leading-5 font-medium whitespace-nowrap text-primary-foreground">
              {t('lodging.media.botFirst')}
            </span>
          )}
          {isCover && (
            <span className="rounded border px-1.5 leading-5 whitespace-nowrap">
              {t('lodging.media.coverTitle')}
            </span>
          )}
        </div>
      </div>
      {canEdit && (
        <div className="flex shrink-0 flex-col items-center gap-1 sm:flex-row">
          <span className="grid size-7 place-items-center">
            <Checkbox
              aria-label={t('lodging.media.select', { label })}
              checked={selected}
              onCheckedChange={(v) => onSelect(v === true)}
            />
          </span>
          <ItemMenu label={label} {...menu} />
        </div>
      )}
    </li>
  );
}
