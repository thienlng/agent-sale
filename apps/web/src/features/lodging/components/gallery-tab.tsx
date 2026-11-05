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

const draftOf = (p: PropertyDto): GalleryDraft => ({
  gallery: cloneGallery(p.gallery),
  galleryCover: p.galleryCover,
});

/**
 * "Ảnh & video" tab (T-192): the folder list, or the open folder (`folderId`, kept in the URL by
 * the route so Back works). One draft of every folder plus the cover, saved with one PATCH.
 */
export function GalleryTab({
  property: p,
  canEdit,
  onDirtyChange,
  uploadImage,
  folderId,
  onFolderChange,
}: {
  property: PropertyDto;
  canEdit: boolean;
  onDirtyChange: (dirty: boolean) => void;
  uploadImage?: GalleryImageUpload | undefined;
  folderId?: string | undefined;
  onFolderChange: (folderId: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const base = useMemo(() => draftOf(p), [p]);
  const { draft, setDraft, dirty, discard } = useTabDraft(base);
  useReportDirty(dirty, onDirtyChange);
  const update = useUpdateProperty();
  const saveError = useSaveError();
  const change = (fn: (d: GalleryDraft) => GalleryDraft) => setDraft((d) => fn(d));
  const open = folderId ? draft.gallery.find((f) => f.id === folderId) : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (update.isPending || !canEdit) return;
    update.mutate(
      {
        id: p.id,
        body: {
          version: p.version,
          patch: { gallery: draft.gallery, galleryCover: draft.galleryCover },
        },
      },
      {
        onSuccess: (saved) => {
          setDraft(draftOf(saved));
          toast.success(t('lodging.editor.saved'), { duration: 3500 });
        },
        onError: (error) => saveError(error, { onStale: discard }),
      },
    );
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
        pending={update.isPending}
        canEdit={canEdit}
        label={t('lodging.media.save')}
      />
    </form>
  );
}
