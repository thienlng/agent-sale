import type { CreateTrainingItemRequest, TrainingItemDto } from '@agent-sales/contracts';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { errorMessage } from '@/lib/errors';

import { useSaveTrainingItem } from '../api/training';
import { type FolderSummary, UNCATEGORIZED } from '../utils/media-library';

/** Full save payload for an existing item with some fields changed. */
export function itemInput(
  item: TrainingItemDto,
  patch: Partial<CreateTrainingItemRequest>,
): CreateTrainingItemRequest & { id: string } {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    content: item.content,
    trigger: item.trigger,
    mediaUrl: item.mediaUrl,
    folderId: item.folderId,
    ...patch,
  };
}

/** One text field dialog: create/rename a folder, rename an image. */
export function NameDialog({
  botId,
  title,
  label,
  item,
  kind,
  onClose,
}: {
  botId: string;
  title: string;
  label: string;
  /** null = create a new folder. */
  item: TrainingItemDto | null;
  kind: 'media' | 'media_folder';
  onClose: () => void;
}) {
  const { t } = useTranslation('training');
  const { t: common } = useTranslation();
  const save = useSaveTrainingItem(botId);
  const [name, setName] = useState(item?.title ?? '');
  const value = name.trim();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!value) return;
    const input = item
      ? itemInput(item, {
          title: value,
          // A folder keeps its name as content; an image keeps its own description.
          ...(kind === 'media_folder' ? { content: value } : {}),
        })
      : {
          kind,
          title: value,
          content: value,
          trigger: '',
          mediaUrl: null,
          folderId: null,
        };
    save.mutate(input, {
      onSuccess: () => {
        toast.success(t(kind === 'media' ? 'data.media.imageSaved' : 'data.media.folderSaved'));
        onClose();
      },
      onError: (error) => toast.error(errorMessage(common, error)),
    });
  }

  return (
    <DialogContent className="sm:max-w-md">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="media-name">{label}</Label>
          <Input
            id="media-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
            autoFocus
            required
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('data.cancel')}
          </Button>
          <Button type="submit" disabled={!value || save.isPending}>
            {t('data.save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** Moves an image to another folder (or out of every folder). */
export function MoveImageDialog({
  botId,
  image,
  folders,
  onClose,
}: {
  botId: string;
  image: TrainingItemDto;
  folders: FolderSummary[];
  onClose: () => void;
}) {
  const { t } = useTranslation('training');
  const { t: common } = useTranslation();
  const save = useSaveTrainingItem(botId);
  const [target, setTarget] = useState(image.folderId ?? UNCATEGORIZED);

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(itemInput(image, { folderId: target === UNCATEGORIZED ? null : target }), {
      onSuccess: () => {
        toast.success(t('data.media.imageSaved'));
        onClose();
      },
      onError: (error) => toast.error(errorMessage(common, error)),
    });
  }

  return (
    <DialogContent className="sm:max-w-md">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle className="break-words">
            {t('data.media.moveTitle', { title: image.title })}
          </DialogTitle>
        </DialogHeader>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger aria-label={t('data.media.moveTo')} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNCATEGORIZED}>{t('data.media.uncategorized')}</SelectItem>
            {folders.map((folder) => (
              <SelectItem key={folder.id} value={folder.id}>
                {folder.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('data.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={save.isPending || target === (image.folderId ?? UNCATEGORIZED)}
          >
            {t('data.media.move')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
