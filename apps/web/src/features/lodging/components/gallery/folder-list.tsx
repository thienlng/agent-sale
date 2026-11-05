import { GALLERY_MAX_FOLDERS, type GalleryFolder } from '@agent-sales/contracts';
import { Film, FolderPlus, ImageOff, MoreVertical } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import {
  addFolder,
  canAddFolder,
  coverOf,
  deleteFolder,
  folderCounts,
  folderThumb,
  type GalleryDraft,
  moveFolder,
  nameTaken,
  renameFolder,
  setCover,
} from '../../lib/gallery-model';
import { TextDialog } from './text-dialog';

/** The folder list of the "Ảnh & video" tab, like Drive: cover, folders with counts and ⋮ menus. */
export function FolderList({
  draft,
  canEdit,
  onChange,
  onOpen,
}: {
  draft: GalleryDraft;
  canEdit: boolean;
  onChange: (update: (d: GalleryDraft) => GalleryDraft) => void;
  onOpen: (folderId: string) => void;
}) {
  const { t } = useTranslation();
  // null id = a new folder.
  const [naming, setNaming] = useState<{ id: string | null } | null>(null);
  const [deleting, setDeleting] = useState<GalleryFolder | null>(null);
  const cover = coverOf(draft);
  const renaming = naming?.id ? draft.gallery.find((f) => f.id === naming.id) : undefined;
  const countLabel = (f: GalleryFolder) => {
    const c = folderCounts(f);
    const parts = [
      c.images ? t('lodging.media.photos', { count: c.images }) : '',
      c.videos ? t('lodging.media.videos', { count: c.videos }) : '',
      c.links ? t('lodging.media.links', { count: c.links }) : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : t('lodging.media.emptyFolder');
  };
  const remove = (f: GalleryFolder) => {
    if (f.items.length) setDeleting(f);
    else onChange((d) => deleteFolder(d, f.id));
  };

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('lodging.media.hint')}</p>
      <section aria-label={t('lodging.media.coverTitle')} className="flex items-center gap-3">
        <div className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">
          {cover ? (
            <img
              src={cover}
              alt={t('lodging.media.coverTitle')}
              referrerPolicy="no-referrer"
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <ImageOff className="size-5 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="grid justify-items-start gap-0.5 text-sm">
          <span className="font-medium">{t('lodging.media.coverTitle')}</span>
          <span className="text-muted-foreground">
            {!cover
              ? t('lodging.media.noCover')
              : draft.galleryCover
                ? t('lodging.media.coverChosen')
                : t('lodging.media.coverAuto')}
          </span>
          {canEdit && draft.galleryCover && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => onChange((d) => setCover(d, ''))}
            >
              {t('lodging.media.coverReset')}
            </Button>
          )}
        </div>
      </section>
      {draft.gallery.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t('lodging.media.empty')}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {draft.gallery.map((f, i) => {
            const thumb = folderThumb(f);
            return (
              <li key={f.id} className="flex items-center gap-3 p-2">
                <button
                  type="button"
                  aria-label={t('lodging.media.open', { name: f.name })}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => onOpen(f.id)}
                >
                  <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="absolute inset-0 size-full object-cover"
                      />
                    ) : (
                      <Film className="size-5 text-muted-foreground" aria-hidden />
                    )}
                  </span>
                  <span className="grid min-w-0">
                    <span className="truncate font-medium">{f.name}</span>
                    <span className="text-xs text-muted-foreground">{countLabel(f)}</span>
                  </span>
                </button>
                {canEdit && (
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('lodging.media.folderMenu', { name: f.name })}
                      >
                        <MoreVertical aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setNaming({ id: f.id })}>
                        {t('lodging.media.rename')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={i === 0}
                        onSelect={() => onChange((d) => moveFolder(d, f.id, -1))}
                      >
                        {t('lodging.media.up')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={i === draft.gallery.length - 1}
                        onSelect={() => onChange((d) => moveFolder(d, f.id, 1))}
                      >
                        {t('lodging.media.down')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => remove(f)}>
                        {t('lodging.media.deleteFolder')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!canAddFolder(draft)}
            onClick={() => setNaming({ id: null })}
          >
            <FolderPlus aria-hidden />
            {t('lodging.media.newFolder')}
          </Button>
          {!canAddFolder(draft) && (
            <span className="text-xs text-muted-foreground">
              {t('lodging.media.folderLimit', { max: GALLERY_MAX_FOLDERS })}
            </span>
          )}
        </div>
      )}
      <TextDialog
        open={naming !== null}
        onOpenChange={(open) => {
          if (!open) setNaming(null);
        }}
        title={renaming ? t('lodging.media.renameTitle') : t('lodging.media.newFolder')}
        label={t('lodging.media.folderName')}
        initial={renaming?.name ?? ''}
        maxLength={100}
        submitLabel={renaming ? t('lodging.media.apply') : t('lodging.media.createFolder')}
        validate={(value) =>
          !value.trim()
            ? t('lodging.media.nameRequired')
            : nameTaken(draft, value, renaming?.id)
              ? t('lodging.media.nameTaken')
              : null
        }
        onSubmit={(value) => {
          const id = renaming?.id;
          setNaming(null);
          onChange((d) => (id ? renameFolder(d, id, value) : addFolder(d, value)));
        }}
      />
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('lodging.media.deleteFolderTitle', { name: deleting?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('lodging.media.deleteFolderBody', { count: deleting?.items.length ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('lodging.media.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = deleting?.id;
                setDeleting(null);
                if (id) onChange((d) => deleteFolder(d, id));
              }}
            >
              {t('lodging.media.confirmDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
