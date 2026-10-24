import type { TrainingItemDto } from '@agent-sales/contracts';
import {
  Copy,
  Folder,
  FolderInput,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import type { FolderSummary } from '../utils/media-library';

/** Folder tile: icon, name, image count; the "…" menu only exists for real folders. */
export function FolderCard({
  folder,
  onOpen,
  onRename,
  onDelete,
}: {
  folder: FolderSummary;
  onOpen: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation('training');
  const name = folder.folder ? folder.name : t('data.media.uncategorized');
  const Icon = folder.folder ? Folder : FolderOpen;
  return (
    <li className="relative rounded-xl border bg-card transition-colors hover:border-primary/50 hover:shadow-sm">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col items-start gap-3 rounded-xl p-4 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary-soft">
          <Icon className="size-4.5 text-primary" aria-hidden />
        </span>
        <span className="min-w-0 pr-8">
          <span className="block line-clamp-2 break-words font-semibold">{name}</span>
          <span className="block text-sm text-muted-foreground">
            {t('data.media.imageCount', { count: folder.images.length })}
          </span>
        </span>
      </button>
      {onRename && onDelete ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-3 right-3"
              aria-label={t('data.media.folderMenu', { name })}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onRename}>
              <Pencil />
              {t('data.media.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 />
              {t('data.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

/** Image tile: thumbnail, title and a menu (copy link, rename, move, delete). */
export function ImageCard({
  image,
  onCopy,
  onRename,
  onMove,
  onDelete,
}: {
  image: TrainingItemDto;
  onCopy: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('training');
  return (
    <li className="overflow-hidden rounded-xl border bg-card">
      <a
        href={image.mediaUrl ?? undefined}
        target="_blank"
        rel="noreferrer"
        className="block aspect-[4/3] bg-muted"
      >
        {image.mediaUrl ? (
          <img
            src={image.mediaUrl}
            alt={image.title}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : null}
      </a>
      <div className="flex items-center gap-1 p-2 pl-3">
        <p
          className="min-w-0 flex-1 line-clamp-2 break-words text-sm font-medium"
          title={image.title}
        >
          {image.title}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('data.media.imageMenu', { title: image.title })}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onCopy} disabled={!image.mediaUrl}>
              <Copy />
              {t('data.media.copyUrl')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRename}>
              <Pencil />
              {t('data.media.editImage')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onMove}>
              <FolderInput />
              {t('data.media.moveTo')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 />
              {t('data.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
