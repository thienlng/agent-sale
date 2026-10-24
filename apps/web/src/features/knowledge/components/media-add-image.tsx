import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/errors';

import { useSaveTrainingItem, useUploadBotImage } from '../api/training';
import {
  fileToBase64,
  IMAGE_MIME_TYPES,
  type ImageMimeType,
  imageFileError,
  titleFromFileName,
} from '../utils/media-library';

type Source = 'upload' | 'url';

/** "Thêm hình ảnh": upload a file to storage, or reference an HTTPS link, inside a folder. */
export function AddImageDialog({
  botId,
  folderId,
  onClose,
}: {
  botId: string;
  /** null = not in any folder. */
  folderId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('training');
  const { t: common } = useTranslation();
  const upload = useUploadBotImage(botId);
  const save = useSaveTrainingItem(botId);
  const [source, setSource] = useState<Source>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const pending = upload.isPending || save.isPending;
  const link = url.trim();
  const linkOk = /^https:\/\/\S+$/.test(link);
  const name = title.trim();
  const ready = Boolean(name) && (source === 'upload' ? Boolean(file) && !fileError : linkOk);

  function pick(next: File | undefined) {
    setFile(null);
    setFileError('');
    if (!next) return;
    const error = imageFileError(next);
    if (error) {
      setFileError(t(`data.media.${error}`));
      return;
    }
    setFile(next);
    if (!title.trim()) setTitle(titleFromFileName(next.name));
  }

  const done = {
    onSuccess: () => {
      toast.success(t('data.media.imageSaved'));
      onClose();
    },
    onError: (error: unknown) => toast.error(errorMessage(common, error)),
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    if (source === 'url') {
      save.mutate(
        {
          kind: 'media',
          title: name,
          content: description.trim() || name,
          trigger: '',
          mediaUrl: link,
          folderId,
        },
        done,
      );
      return;
    }
    if (!file) return;
    let base64: string;
    try {
      base64 = await fileToBase64(file);
    } catch {
      setFileError(t('data.media.fileType'));
      return;
    }
    upload.mutate(
      {
        title: name,
        fileName: file.name.slice(-120),
        mimeType: file.type as ImageMimeType,
        base64,
        folderId,
      },
      done,
    );
  }

  return (
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{t('data.media.addImage')}</DialogTitle>
          <DialogDescription>{t('mediaHint')}</DialogDescription>
        </DialogHeader>
        <Tabs value={source} onValueChange={(v) => setSource(v as Source)}>
          <TabsList variant="line">
            <TabsTrigger value="upload">{t('data.media.uploadTab')}</TabsTrigger>
            <TabsTrigger value="url">{t('data.media.urlTab')}</TabsTrigger>
          </TabsList>
        </Tabs>
        {source === 'upload' ? (
          <div className="space-y-2">
            <Label htmlFor="media-file">{t('data.media.file')}</Label>
            <Input
              id="media-file"
              type="file"
              accept={IMAGE_MIME_TYPES.join(',')}
              disabled={pending}
              onChange={(e) => pick(e.target.files?.[0])}
              aria-describedby="media-file-hint"
            />
            <p
              id="media-file-hint"
              role={fileError ? 'alert' : undefined}
              className={fileError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
            >
              {fileError || t('data.media.fileHint')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="media-url">{t('data.media.imageUrl')}</Label>
            <Input
              id="media-url"
              type="url"
              inputMode="url"
              placeholder="https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={2000}
              aria-invalid={Boolean(link) && !linkOk}
            />
            {link && !linkOk ? (
              <p className="text-xs text-destructive">{t('data.media.imageUrlInvalid')}</p>
            ) : null}
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="media-title">{t('data.media.imageTitle')}</Label>
          <Input
            id="media-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            required
          />
        </div>
        {source === 'url' ? (
          <div className="space-y-2">
            <Label htmlFor="media-description">{t('data.media.imageDescription')}</Label>
            <Textarea
              id="media-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={8000}
              rows={3}
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {t('data.cancel')}
          </Button>
          <Button type="submit" disabled={!ready || pending}>
            {source === 'upload' ? t('data.media.upload') : t('data.save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
