import type { PropertyDto } from '@agent-sales/contracts';
import { type FormEvent, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useUpdateProperty } from '../api/properties';
import { useSaveError } from '../hooks/use-save-error';
import { cloneGallery, type GalleryDraft, type GalleryImageUpload } from '../lib/gallery-model';
import { FolderList } from './gallery/folder-list';
import { FolderView } from './gallery/folder-view';
import { TabSaveBar, useReportDirty, useTabDraft } from './property-tab-parts';

/** The editable copy of any gallery owner (a property or one of its units). */
export const galleryDraftOf = (owner: {
  gallery: PropertyDto['gallery'];
  galleryCover: string;
}): GalleryDraft => ({
  gallery: cloneGallery(owner.gallery),
  galleryCover: owner.galleryCover,
});

/** What a gallery owner does on save: `saved` takes the stored copy, `stale` drops the edits. */
export type GallerySave = (
  draft: GalleryDraft,
  done: { saved: (next: GalleryDraft) => void; stale: () => void },
) => void;

export interface GalleryFormProps {
  /** The stored gallery (memoised by the caller). */
  base: GalleryDraft;
  canEdit: boolean;
  pending: boolean;
  onSave: GallerySave;
  onDirtyChange: (dirty: boolean) => void;
  uploadImage?: GalleryImageUpload | undefined;
  folderId?: string | undefined;
  onFolderChange: (folderId: string | undefined) => void;
}

/**
 * The T-192 folder UI for any gallery: the folder list, or the open folder (`folderId`, kept
 * in the URL by the route so Back works). One draft of every folder plus the cover, handed to
 * `onSave` as a whole.
 */
export function GalleryForm({
  base,
  canEdit,
  pending,
  onSave,
  onDirtyChange,
  uploadImage,
  folderId,
  onFolderChange,
}: GalleryFormProps) {
  const { t } = useTranslation();
  const { draft, setDraft, dirty, discard } = useTabDraft(base);
  useReportDirty(dirty, onDirtyChange);
  const change = (fn: (d: GalleryDraft) => GalleryDraft) => setDraft((d) => fn(d));
  const open = folderId ? draft.gallery.find((f) => f.id === folderId) : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending || !canEdit) return;
    onSave(draft, {
      saved: (next) => {
        setDraft(next);
        toast.success(t('lodging.editor.saved'), { duration: 3500 });
      },
      stale: discard,
    });
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      {open ? (
        <FolderView
          draft={draft}
          folder={open}
          canEdit={canEdit}
          onChange={change}
          onBack={() => onFolderChange(undefined)}
          uploadImage={uploadImage}
        />
      ) : (
        <FolderList draft={draft} canEdit={canEdit} onChange={change} onOpen={onFolderChange} />
      )}
      <TabSaveBar
        dirty={dirty}
        pending={pending}
        canEdit={canEdit}
        label={t('lodging.media.save')}
      />
    </form>
  );
}

/** "Ảnh & video" tab of a property (T-192): its gallery, saved with one PATCH. */
export function GalleryTab({
  property: p,
  ...rest
}: { property: PropertyDto } & Omit<GalleryFormProps, 'base' | 'pending' | 'onSave'>) {
  const base = useMemo(() => galleryDraftOf(p), [p]);
  const update = useUpdateProperty();
  const saveError = useSaveError();
  const save: GallerySave = (draft, done) =>
    update.mutate(
      {
        id: p.id,
        body: {
          version: p.version,
          patch: { gallery: draft.gallery, galleryCover: draft.galleryCover },
        },
      },
      {
        onSuccess: (saved) => done.saved(galleryDraftOf(saved)),
        onError: (error) => saveError(error, { onStale: done.stale }),
      },
    );
  return <GalleryForm {...rest} base={base} pending={update.isPending} onSave={save} />;
}
