import type { PropertyDto } from '@agent-sales/contracts';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useUpdateProperty } from '../api/properties';
import { useSaveError } from '../hooks/use-save-error';
import { GalleryEditor, type GalleryPhoto, type GalleryUploadSlot } from './gallery-editor';
import { TabSaveBar, useReportDirty, useTabDraft } from './property-tab-parts';

/** "Ảnh" tab: captioned photos (first = cover), saved as the whole gallery. */
export function GalleryTab({
  property: p,
  canEdit,
  onDirtyChange,
  renderUpload,
}: {
  property: PropertyDto;
  canEdit: boolean;
  onDirtyChange: (dirty: boolean) => void;
  renderUpload?: GalleryUploadSlot | undefined;
}) {
  const { t } = useTranslation();
  const base = useMemo<GalleryPhoto[]>(() => p.gallery.map((g) => ({ ...g })), [p]);
  const { draft, setDraft, dirty } = useTabDraft(base);
  useReportDirty(dirty, onDirtyChange);
  const [submitted, setSubmitted] = useState(false);
  const update = useUpdateProperty();
  const saveError = useSaveError();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (draft.some((g) => !g.caption.trim()) || update.isPending || !canEdit) return;
    update.mutate(
      {
        id: p.id,
        body: {
          version: p.version,
          patch: { gallery: draft.map((g) => ({ url: g.url, caption: g.caption.trim() })) },
        },
      },
      {
        onSuccess: (saved) => {
          setDraft(saved.gallery.map((g) => ({ ...g })));
          setSubmitted(false);
          toast.success(t('lodging.editor.saved'), { duration: 3500 });
        },
        onError: (error) => saveError(error),
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('lodging.photos.hint')}</p>
      <GalleryEditor
        value={draft}
        onChange={setDraft}
        disabled={!canEdit}
        showErrors={submitted}
        renderUpload={renderUpload}
      />
      <TabSaveBar
        dirty={dirty}
        pending={update.isPending}
        canEdit={canEdit}
        label={t('lodging.photos.save')}
      />
    </form>
  );
}
