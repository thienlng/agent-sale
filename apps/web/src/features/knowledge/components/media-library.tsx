import type { TrainingItemDto } from '@agent-sales/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

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
import { Dialog } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';

import { useDeleteTrainingItem, useTrainingItems } from '../api/training';
import { type FolderSummary, summarizeLibrary } from '../utils/media-library';
import { DataError, DataPageHeader } from './data-page';
import { AddImageDialog } from './media-add-image';
import { MoveImageDialog, NameDialog } from './media-dialogs';
import { FolderGrid, FolderView } from './media-views';

type Editor =
  | { type: 'folder'; item: TrainingItemDto | null }
  | { type: 'image'; item: TrainingItemDto }
  | { type: 'move'; item: TrainingItemDto }
  | { type: 'add' };
type Deleting =
  { type: 'folder'; folder: FolderSummary } | { type: 'image'; item: TrainingItemDto };

/** "Thư viện ảnh": folders of images the bot may send. `folderId` selects the open folder. */
export function MediaLibrary({
  botId,
  folderId,
  onFolderChange,
}: {
  botId: string;
  folderId: string | undefined;
  onFolderChange: (folderId: string | undefined) => void;
}) {
  const { t } = useTranslation('training');
  const { t: common } = useTranslation();
  const items = useTrainingItems(botId);
  const remove = useDeleteTrainingItem(botId);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const library = summarizeLibrary(items.data ?? []);
  const open =
    library.folders.find((f) => f.id === folderId) ??
    (library.uncategorized?.id === folderId ? library.uncategorized : null);
  const close = () => setEditor(null);

  const copy = (image: TrainingItemDto) => {
    if (!image.mediaUrl) return;
    navigator.clipboard.writeText(image.mediaUrl).then(
      () => toast.success(t('data.media.copied')),
      () => toast.error(image.mediaUrl),
    );
  };
  const confirmDelete = () => {
    if (!deleting) return;
    const id = deleting.type === 'folder' ? deleting.folder.id : deleting.item.id;
    remove.mutate(id, {
      onSuccess: () => {
        toast.success(
          t(deleting.type === 'folder' ? 'data.media.folderDeleted' : 'data.media.imageDeleted'),
        );
        if (deleting.type === 'folder' && folderId === id) onFolderChange(undefined);
      },
      onError: (error) => toast.error(errorMessage(common, error)),
    });
    setDeleting(null);
  };

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <DataPageHeader
        title={t('data.media.title')}
        aside={
          items.data ? (
            <div className="w-40" aria-live="polite">
              <p className="flex justify-between text-sm font-medium">
                <span>{t('data.media.imagesLabel')}</span>
                <span className="tabular-nums">{library.imageCount}</span>
              </p>
              <div className="mt-1.5 h-1 rounded-full bg-primary/25" aria-hidden />
            </div>
          ) : null
        }
      />
      <Separator />
      {items.isPending ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : items.isError ? (
        <DataError onRetry={() => void items.refetch()} />
      ) : open ? (
        <FolderView
          folder={open}
          onBack={() => onFolderChange(undefined)}
          onAdd={() => setEditor({ type: 'add' })}
          onCopy={copy}
          onRename={(item) => setEditor({ type: 'image', item })}
          onMove={(item) => setEditor({ type: 'move', item })}
          onDelete={(item) => setDeleting({ type: 'image', item })}
        />
      ) : (
        <FolderGrid
          folders={library.folders}
          uncategorized={library.uncategorized}
          onOpen={onFolderChange}
          onAdd={() => setEditor({ type: 'folder', item: null })}
          onRename={(item) => setEditor({ type: 'folder', item })}
          onDelete={(folder) => setDeleting({ type: 'folder', folder })}
        />
      )}

      <Dialog open={editor !== null} onOpenChange={(o) => !o && close()}>
        {editor?.type === 'folder' ? (
          <NameDialog
            botId={botId}
            kind="media_folder"
            item={editor.item}
            title={t(editor.item ? 'data.media.renameFolder' : 'data.media.addFolder')}
            label={t('data.media.folderName')}
            onClose={close}
          />
        ) : editor?.type === 'image' ? (
          <NameDialog
            botId={botId}
            kind="media"
            item={editor.item}
            title={t('data.media.editImage')}
            label={t('data.media.imageTitle')}
            onClose={close}
          />
        ) : editor?.type === 'move' ? (
          <MoveImageDialog
            botId={botId}
            image={editor.item}
            folders={library.folders}
            onClose={close}
          />
        ) : editor?.type === 'add' ? (
          <AddImageDialog botId={botId} folderId={open?.folder?.id ?? null} onClose={close} />
        ) : null}
      </Dialog>
      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">
              {deleting?.type === 'folder'
                ? t('data.media.deleteFolderConfirm', { name: deleting.folder.name })
                : t('data.media.deleteImageConfirm', { title: deleting?.item.title ?? '' })}
            </AlertDialogTitle>
            {deleting?.type === 'folder' ? (
              <AlertDialogDescription>
                {t('data.media.deleteFolderBody', { count: deleting.folder.images.length })}
              </AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('data.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              {t('data.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
