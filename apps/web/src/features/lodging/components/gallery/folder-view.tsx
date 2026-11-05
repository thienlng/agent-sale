import {
  BOT_ALBUM_PAGE_SIZE,
  GALLERY_MAX_ITEMS,
  type GalleryFolder,
  type GalleryItem,
} from '@agent-sales/contracts';
import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ChevronLeft, ImagePlus, Link2, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { MEDIA_ACCEPT, useMediaUpload } from '../../hooks/use-media-upload';
import {
  appendItems,
  coverOf,
  type GalleryDraft,
  type GalleryImageUpload,
  hostOf,
  imageNumbers,
  itemKeys,
  moveItem,
  moveItemsTo,
  remainingItems,
  removeItems,
  reorderItems,
  setCaption,
  setCover,
} from '../../lib/gallery-model';
import { savedView, SelectionBar, type ViewMode, ViewToggle } from './folder-toolbar';
import { LinkDialog } from './link-dialog';
import { MediaRow } from './media-row';
import { MediaTile } from './media-tile';
import { MediaViewer } from './media-viewer';
import { MoveDialog } from './move-dialog';
import { TextDialog } from './text-dialog';

type Translate = ReturnType<typeof useTranslation>['t'];

/** What a tile is called in menus and announcements: "Ảnh 3", a video's caption, a link's host. */
function itemLabel(t: Translate, item: GalleryItem, number: number | null): string {
  if (item.kind === 'image') return t('lodging.media.number', { n: number ?? 0 });
  if (item.kind === 'video') return item.caption || t('lodging.media.videoBadge');
  return item.caption || hostOf(item.url);
}

/** Inside one folder: add photos/videos/links, numbered sortable grid, multi-select (spec §5). */
export function FolderView({
  draft,
  folder,
  canEdit,
  onChange,
  onBack,
  uploadImage,
}: {
  draft: GalleryDraft;
  folder: GalleryFolder;
  canEdit: boolean;
  onChange: (update: (d: GalleryDraft) => GalleryDraft) => void;
  onBack: () => void;
  uploadImage?: GalleryImageUpload | undefined;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [moving, setMoving] = useState<number[] | null>(null);
  const [captioning, setCaptioning] = useState<number | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [view, setView] = useState<ViewMode>(savedView);
  const [viewing, setViewing] = useState<number | null>(null);
  const remaining = remainingItems(draft);
  const full = remaining <= 0;
  const { entries, upload } = useMediaUpload({
    uploadImage,
    remaining,
    onItems: (items) => onChange((d) => appendItems(d, folder.id, items)),
  });
  const keys = itemKeys(folder.items);
  const numbers = imageNumbers(folder.items);
  const labels = folder.items.map((item, i) => itemLabel(t, item, numbers[i] ?? null));
  const labelOf = (id: string | number) => labels[keys.indexOf(String(id))] ?? '';
  const positionOf = (id: string | number) => keys.indexOf(String(id)) + 1;
  const others = draft.gallery.filter((f) => f.id !== folder.id);
  const cover = coverOf(draft);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('lodging.media.dragStart', { label: labelOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over
        ? t('lodging.media.dragOver', { label: labelOf(active.id), position: positionOf(over.id) })
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? t('lodging.media.dragEnd', { label: labelOf(active.id), position: positionOf(over.id) })
        : undefined,
    onDragCancel: ({ active }) => t('lodging.media.dragCancel', { label: labelOf(active.id) }),
  };
  // Positions change after any structural edit, so the selection (by index) is cleared.
  const edit = (fn: (d: GalleryDraft) => GalleryDraft) => {
    setSelected(new Set());
    onChange(fn);
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = keys.indexOf(String(active.id));
    const to = keys.indexOf(String(over.id));
    edit((d) => reorderItems(d, folder.id, from, to));
  };
  const toggle = (i: number, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(i);
      else next.delete(i);
      return next;
    });

  return (
    <div className="grid gap-4">
      {/* Phones: back + name on row 1 (the name wraps, never truncated), actions on row 2. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="-ml-2 shrink-0"
            onClick={onBack}
          >
            <ChevronLeft aria-hidden />
            {t('lodging.media.back')}
          </Button>
          <h2 className="min-w-0 text-base font-semibold break-words">{folder.name}</h2>
        </div>
        {canEdit && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={MEDIA_ACCEPT}
              multiple
              hidden
              aria-label={t('lodging.media.add')}
              data-testid="media-file-input"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                void upload(files);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={full}
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus aria-hidden />
              {t('lodging.media.add')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={full}
              onClick={() => setLinkOpen(true)}
            >
              <Link2 aria-hidden />
              {t('lodging.media.addLink')}
            </Button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t('lodging.media.help', { count: BOT_ALBUM_PAGE_SIZE })}
        </p>
        <ViewToggle value={view} onChange={setView} />
      </div>
      {canEdit && (
        <p className="text-xs text-muted-foreground tabular-nums">
          {full
            ? t('lodging.media.full', { max: GALLERY_MAX_ITEMS })
            : t('lodging.media.remaining', { count: remaining })}
        </p>
      )}
      {entries.length > 0 && (
        <ul className="grid gap-1 text-sm" aria-live="polite">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              <span className="min-w-0 truncate">
                {t('lodging.media.uploading', { name: e.name })}
              </span>
              {e.kind === 'video' && (
                <progress max={1} value={e.progress} aria-label={e.name} className="h-1.5 w-24" />
              )}
            </li>
          ))}
        </ul>
      )}
      {selected.size > 0 && (
        <SelectionBar
          count={selected.size}
          canMove={others.length > 0}
          onMove={() => setMoving([...selected].sort((x, y) => x - y))}
          onRemove={() => edit((d) => removeItems(d, folder.id, [...selected]))}
          onClear={() => setSelected(new Set())}
        />
      )}
      <div
        data-testid="media-drop-zone"
        className={cn(
          'rounded-lg border border-dashed p-2',
          dragging && 'border-primary bg-accent',
        )}
        // Files dropped here never open in the browser, even when the folder cannot take them.
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          // Read-only refuses the drop outright; a full property still takes it, to say why.
          if (!canEdit) e.dataTransfer.dropEffect = 'none';
          else if (!full) setDragging(true);
        }}
        onDragLeave={(e) => {
          // Moving between children fires dragleave on the zone; only leaving it counts.
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDragging(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          if (!canEdit) return;
          if (full) toast.error(t('lodging.media.full', { max: GALLERY_MAX_ITEMS }));
          else void upload(Array.from(e.dataTransfer.files));
        }}
      >
        {folder.items.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {t('lodging.media.dropHere')}
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            accessibility={{
              announcements,
              screenReaderInstructions: { draggable: t('lodging.media.dragInstructions') },
            }}
          >
            {view === 'grid' ? (
              <SortableContext items={keys} strategy={rectSortingStrategy}>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {folder.items.map((item, i) => {
                    const number = numbers[i] ?? null;
                    return (
                      <MediaTile
                        key={keys[i]}
                        id={keys[i] ?? String(i)}
                        item={item}
                        label={labels[i] ?? ''}
                        number={number}
                        early={number !== null && number <= BOT_ALBUM_PAGE_SIZE}
                        showEarlyLabel={number === 1}
                        isCover={item.kind === 'image' && item.url === cover}
                        canSetCover={item.kind === 'image' && item.url !== draft.galleryCover}
                        canEdit={canEdit}
                        selected={selected.has(i)}
                        first={i === 0}
                        last={i === folder.items.length - 1}
                        canMove={others.length > 0}
                        onSelect={(on) => toggle(i, on)}
                        onUp={() => edit((d) => moveItem(d, folder.id, i, -1))}
                        onDown={() => edit((d) => moveItem(d, folder.id, i, 1))}
                        onMove={() => setMoving([i])}
                        onCover={() => onChange((d) => setCover(d, item.url))}
                        onCaption={() => setCaptioning(i)}
                        onRemove={() => edit((d) => removeItems(d, folder.id, [i]))}
                        onOpen={() => setViewing(i)}
                      />
                    );
                  })}
                </ul>
              </SortableContext>
            ) : (
              <SortableContext items={keys} strategy={verticalListSortingStrategy}>
                <ul className="divide-y overflow-hidden rounded-md border">
                  {folder.items.map((item, i) => {
                    const number = numbers[i] ?? null;
                    return (
                      <MediaRow
                        key={keys[i]}
                        id={keys[i] ?? String(i)}
                        item={item}
                        label={labels[i] ?? ''}
                        number={number}
                        early={number !== null && number <= BOT_ALBUM_PAGE_SIZE}
                        isCover={item.kind === 'image' && item.url === cover}
                        canSetCover={item.kind === 'image' && item.url !== draft.galleryCover}
                        canEdit={canEdit}
                        selected={selected.has(i)}
                        folderName={folder.name}
                        first={i === 0}
                        last={i === folder.items.length - 1}
                        canMove={others.length > 0}
                        onSelect={(on) => toggle(i, on)}
                        onUp={() => edit((d) => moveItem(d, folder.id, i, -1))}
                        onDown={() => edit((d) => moveItem(d, folder.id, i, 1))}
                        onMove={() => setMoving([i])}
                        onCover={() => onChange((d) => setCover(d, item.url))}
                        onCaption={() => setCaptioning(i)}
                        onCaptionChange={(caption) =>
                          onChange((d) => setCaption(d, folder.id, i, caption))
                        }
                        onRemove={() => edit((d) => removeItems(d, folder.id, [i]))}
                        onOpen={() => setViewing(i)}
                      />
                    );
                  })}
                </ul>
              </SortableContext>
            )}
          </DndContext>
        )}
      </div>
      <MediaViewer
        items={folder.items}
        labels={labels}
        index={viewing !== null && viewing < folder.items.length ? viewing : null}
        folderName={folder.name}
        canEdit={canEdit}
        onIndexChange={setViewing}
        onClose={() => setViewing(null)}
        onCaptionChange={(index, caption) =>
          onChange((d) => setCaption(d, folder.id, index, caption))
        }
      />
      <LinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        onAdd={(item) => onChange((d) => appendItems(d, folder.id, [item]))}
      />
      <MoveDialog
        open={moving !== null}
        folders={others}
        onOpenChange={(open) => {
          if (!open) setMoving(null);
        }}
        onPick={(toId) => {
          const picked = moving ?? [];
          setMoving(null);
          edit((d) => moveItemsTo(d, folder.id, picked, toId));
        }}
      />
      <TextDialog
        open={captioning !== null}
        onOpenChange={(open) => {
          if (!open) setCaptioning(null);
        }}
        title={t('lodging.media.editCaption')}
        label={t('lodging.media.caption')}
        placeholder={t('lodging.media.captionPlaceholder')}
        initial={captioning !== null ? (folder.items[captioning]?.caption ?? '') : ''}
        maxLength={300}
        submitLabel={t('lodging.media.apply')}
        onSubmit={(value) => {
          const index = captioning;
          setCaptioning(null);
          if (index !== null) onChange((d) => setCaption(d, folder.id, index, value.trim()));
        }}
      />
    </div>
  );
}
