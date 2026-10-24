import type { TrainingItemDto } from '@agent-sales/contracts';
import { ArrowDownUp, ChevronLeft, FolderPlus, ImagePlus } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { type FolderSort, type FolderSummary, visibleFolders } from '../utils/media-library';
import { DataEmptyState, DataSearch } from './data-page';
import { FolderCard, ImageCard } from './media-cards';

const SORTS = [
  ['newest', 'data.media.sortNewest'],
  ['oldest', 'data.media.sortOldest'],
  ['name', 'data.media.sortName'],
] as const;

/** Root of the library: folder search, sort, "Thêm thư mục" and the folder grid. */
export function FolderGrid({
  folders,
  uncategorized,
  onOpen,
  onAdd,
  onRename,
  onDelete,
}: {
  folders: FolderSummary[];
  uncategorized: FolderSummary | null;
  onOpen: (id: string) => void;
  onAdd: () => void;
  onRename: (folder: TrainingItemDto) => void;
  onDelete: (folder: FolderSummary) => void;
}) {
  const { t } = useTranslation('training');
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [sort, setSort] = useState<FolderSort>('newest');
  const list = visibleFolders(folders, deferred, sort);
  const showLoose = uncategorized && !deferred.trim();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <DataSearch value={query} onChange={setQuery} placeholder={t('data.media.search')} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-9">
              {t('data.media.sort')}
              <ArrowDownUp aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as FolderSort)}>
              {SORTS.map(([key, label]) => (
                <DropdownMenuRadioItem key={key} value={key}>
                  {t(label)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button className="ml-auto h-9" onClick={onAdd}>
          <FolderPlus />
          {t('data.media.addFolder')}
        </Button>
      </div>
      {list.length || showLoose ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {list.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              onOpen={() => onOpen(folder.id)}
              onRename={() => folder.folder && onRename(folder.folder)}
              onDelete={() => onDelete(folder)}
            />
          ))}
          {showLoose ? (
            <FolderCard folder={uncategorized} onOpen={() => onOpen(uncategorized.id)} />
          ) : null}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed">
          <DataEmptyState
            message={folders.length ? t('data.media.noFolderMatch') : t('data.media.noFolders')}
          />
        </div>
      )}
    </div>
  );
}

/** Inside one folder: breadcrumb back to the root, "Thêm hình ảnh" and the image grid. */
export function FolderView({
  folder,
  onBack,
  onAdd,
  onCopy,
  onRename,
  onMove,
  onDelete,
}: {
  folder: FolderSummary;
  onBack: () => void;
  onAdd: () => void;
  onCopy: (image: TrainingItemDto) => void;
  onRename: (image: TrainingItemDto) => void;
  onMove: (image: TrainingItemDto) => void;
  onDelete: (image: TrainingItemDto) => void;
}) {
  const { t } = useTranslation('training');
  const name = folder.folder ? folder.name : t('data.media.uncategorized');
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label={t('data.media.back')}>
          <ChevronLeft />
        </Button>
        <Breadcrumb className="min-w-0 flex-1">
          <BreadcrumbList>
            <BreadcrumbItem>
              <button type="button" onClick={onBack} className="hover:text-foreground">
                {t('data.media.title')}
              </button>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate font-medium">{name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <Button className="h-9" onClick={onAdd}>
          <ImagePlus />
          {t('data.media.addImage')}
        </Button>
      </div>
      {folder.images.length ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {folder.images.map((image) => (
            <ImageCard
              key={image.id}
              image={image}
              onCopy={() => onCopy(image)}
              onRename={() => onRename(image)}
              onMove={() => onMove(image)}
              onDelete={() => onDelete(image)}
            />
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed">
          <DataEmptyState message={t('data.media.emptyFolder')}>
            <Button variant="outline" onClick={onAdd}>
              <ImagePlus />
              {t('data.media.addImage')}
            </Button>
          </DataEmptyState>
        </div>
      )}
    </div>
  );
}
