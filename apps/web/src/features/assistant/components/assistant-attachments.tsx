import {
  type CreateImportBatchRequest,
  IMPORT_MAX_PHOTOS,
  MAX_PRODUCT_IMAGES,
} from '@agent-sales/contracts';
import { FileSpreadsheet, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ImageUnreadableError, resizeImage, thumbnail } from '@/lib/resize-image';
import { isSpreadsheetName, readSpreadsheet } from '@/lib/spreadsheet';
import { cn } from '@/lib/utils';

import { uploadImportPhoto } from '../api/imports';

/** What the file picker offers (sheets and product photos). */
export const ATTACH_ACCEPT = '.xlsx,.csv,image/jpeg,image/png,image/webp';

export type PhotoGrouping = 'per_photo' | 'one_product';

interface PhotoItem {
  id: string;
  name: string;
  previewUrl: string | null;
  status: 'uploading' | 'ready' | 'error';
  imageUrl?: string;
  thumb?: { mimeType: 'image/jpeg'; base64: string };
}

type Attachment =
  | { kind: 'none' }
  | {
      kind: 'sheet';
      name: string;
      status: 'reading' | 'ready' | 'error';
      rows?: string[][];
    }
  | { kind: 'photos'; items: PhotoItem[]; grouping: PhotoGrouping };

/** An i18n key of the `assistant` namespace with its values. */
export interface TrayError {
  key: string;
  values?: Record<string, unknown>;
}

const NONE: Attachment = { kind: 'none' };
const isHeic = (f: File) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);
const isPhoto = (f: File) =>
  /^image\/(jpeg|png|webp)$/i.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);
const objectUrl = (f: File): string | null =>
  typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : null;
const revoke = (url: string | null) => {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
};

/**
 * The files the owner attached to the next message (T-173): one sheet, read in the browser at
 * once, or up to 8 product photos, each resized (WebP → JPEG), uploaded to the business's product
 * pictures and thumbnailed for the vision call. Errors are i18n keys shown in the tray.
 */
/** The sheet's rows without blank ones and the header row (AS-24): what the owner counts. */
export function dataRowCount(rows: readonly (readonly string[])[]): number {
  const filled = rows.filter((r) => r.some((c) => c.trim() !== '')).length;
  return Math.max(0, filled - 1);
}

export function useAssistantAttachments(businessId: string) {
  const [attachment, setAttachment] = useState<Attachment>(NONE);
  const [error, setError] = useState<TrayError | null>(null);
  const [creating, setCreating] = useState(false);
  // Uploads finishing after a clear or a business switch must not come back.
  const generation = useRef(0);

  const clear = useCallback(() => {
    generation.current++;
    setAttachment((a) => {
      if (a.kind === 'photos') for (const p of a.items) revoke(p.previewUrl);
      return NONE;
    });
    setError(null);
    setCreating(false);
  }, []);

  // Another business: its uploads belong to the old one.
  useEffect(() => clear, [businessId, clear]);

  function updatePhoto(gen: number, id: string, patch: Partial<PhotoItem>): void {
    if (gen !== generation.current) return;
    setAttachment((a) =>
      a.kind === 'photos'
        ? { ...a, items: a.items.map((p) => (p.id === id ? { ...p, ...patch } : p)) }
        : a,
    );
  }

  async function uploadPhoto(gen: number, item: PhotoItem, file: File): Promise<void> {
    try {
      const resized = await resizeImage(file);
      const imageUrl = await uploadImportPhoto(businessId, resized);
      const thumb = await thumbnail(file);
      updatePhoto(gen, item.id, { status: 'ready', imageUrl, thumb });
    } catch (e) {
      updatePhoto(gen, item.id, { status: 'error' });
      if (gen === generation.current) {
        setError({
          key:
            e instanceof ImageUnreadableError
              ? 'import.errors.unreadableImage'
              : 'import.errors.upload',
        });
      }
    }
  }

  async function readSheet(gen: number, file: File): Promise<void> {
    const out = await readSpreadsheet(file).catch(() => ({ error: 'format' as const }));
    if (gen !== generation.current) return;
    if ('error' in out) {
      setAttachment({ kind: 'sheet', name: file.name, status: 'error' });
      setError({ key: `import.errors.${out.error}` });
    } else {
      setAttachment({ kind: 'sheet', name: file.name, status: 'ready', rows: out.rows });
    }
  }

  function addFiles(list: FileList | readonly File[]): void {
    const files = Array.from(list);
    if (files.length === 0) return;
    setError(null);
    if (files.some(isHeic)) {
      setError({ key: 'import.errors.heic' });
      return;
    }
    const sheets = files.filter((f) => isSpreadsheetName(f.name));
    const photos = files.filter((f) => !isSpreadsheetName(f.name) && isPhoto(f));
    if (sheets.length + photos.length < files.length) {
      setError({ key: 'import.errors.unsupported' });
      return;
    }
    if (
      sheets.length > 1 ||
      (sheets.length && photos.length) ||
      (sheets.length && attachment.kind === 'photos') ||
      (photos.length && attachment.kind === 'sheet')
    ) {
      setError({ key: 'import.errors.mixed' });
      return;
    }
    const sheet = sheets[0];
    if (sheet) {
      const gen = ++generation.current;
      setAttachment({ kind: 'sheet', name: sheet.name, status: 'reading' });
      void readSheet(gen, sheet);
      return;
    }
    const current = attachment.kind === 'photos' ? attachment.items : [];
    if (current.length + photos.length > IMPORT_MAX_PHOTOS) {
      setError({ key: 'import.errors.tooManyPhotos', values: { max: IMPORT_MAX_PHOTOS } });
      return;
    }
    const gen = generation.current;
    const added = photos.map((file) => ({
      file,
      item: {
        id: crypto.randomUUID(),
        name: file.name,
        previewUrl: objectUrl(file),
        status: 'uploading' as const,
      },
    }));
    setAttachment({
      kind: 'photos',
      grouping: attachment.kind === 'photos' ? attachment.grouping : 'per_photo',
      items: [...current, ...added.map((a) => a.item)],
    });
    for (const { file, item } of added) void uploadPhoto(gen, item, file);
  }

  function remove(id: string | null): void {
    setError(null);
    if (attachment.kind !== 'photos' || id === null) {
      clear();
      return;
    }
    const left = attachment.items.filter((p) => p.id !== id);
    revoke(attachment.items.find((p) => p.id === id)?.previewUrl ?? null);
    setAttachment(left.length ? { ...attachment, items: left } : NONE);
  }

  function setGrouping(grouping: PhotoGrouping): void {
    setError(null);
    setAttachment((a) => (a.kind === 'photos' ? { ...a, grouping } : a));
  }

  const busy =
    (attachment.kind === 'sheet' && attachment.status === 'reading') ||
    (attachment.kind === 'photos' && attachment.items.some((p) => p.status === 'uploading'));
  const ready =
    (attachment.kind === 'sheet' && attachment.status === 'ready') ||
    (attachment.kind === 'photos' &&
      attachment.items.length > 0 &&
      attachment.items.every((p) => p.status === 'ready'));

  /** The batch to create for the business, or why it cannot be sent yet. */
  function request(): { body: CreateImportBatchRequest; label: string; count: number } | TrayError {
    if (attachment.kind === 'sheet' && attachment.status === 'ready' && attachment.rows) {
      return {
        body: {
          kind: 'sheet',
          businessId,
          fileName: attachment.name.slice(0, 200),
          rows: attachment.rows,
        },
        label: attachment.name,
        count: attachment.rows.length,
      };
    }
    if (attachment.kind === 'photos' && ready) {
      if (attachment.grouping === 'one_product' && attachment.items.length > MAX_PRODUCT_IMAGES) {
        return { key: 'import.errors.oneProductMax', values: { max: MAX_PRODUCT_IMAGES } };
      }
      return {
        body: {
          kind: 'photos',
          businessId,
          grouping: attachment.grouping,
          items: attachment.items.map((p) => ({
            imageUrl: p.imageUrl ?? '',
            mimeType: p.thumb?.mimeType ?? 'image/jpeg',
            base64: p.thumb?.base64 ?? '',
          })),
        },
        label: '',
        count: attachment.items.length,
      };
    }
    return { key: 'import.errors.notReady' };
  }

  return {
    attachment,
    error,
    setError,
    creating,
    setCreating,
    active: attachment.kind !== 'none',
    busy,
    ready,
    addFiles,
    remove,
    setGrouping,
    request,
    clear,
  };
}

export type AssistantAttachments = ReturnType<typeof useAssistantAttachments>;

/** The tray above the message box: the sheet or the photos, the grouping choice and progress. */
export function AttachmentTray({ attachments }: { attachments: AssistantAttachments }) {
  const { t } = useTranslation('assistant');
  const { attachment, error, creating } = attachments;
  if (attachment.kind === 'none' && !error) return null;
  return (
    <div
      data-measure
      className="flex flex-col gap-2 border-t px-3 pt-2"
      aria-label={t('import.tray')}
      role="group"
    >
      {attachment.kind === 'sheet' ? (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-2 py-1.5 text-sm">
          <FileSpreadsheet className="size-4 shrink-0 text-brand-text" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
          {attachment.status === 'reading' ? (
            <span className="text-xs text-muted-foreground">{t('import.reading')}</span>
          ) : attachment.rows ? (
            <span className="text-xs text-muted-foreground">
              {t('import.rows', { count: dataRowCount(attachment.rows) })}
            </span>
          ) : null}
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-offset-3 focus-visible:ring-offset-background focus-visible:ring-ring focus-visible:outline-none"
            aria-label={t('import.remove', { name: attachment.name })}
            disabled={creating}
            onClick={() => attachments.remove(null)}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}
      {attachment.kind === 'photos' ? (
        <>
          <ul className="flex flex-wrap gap-2">
            {attachment.items.map((p) => (
              <li
                key={p.id}
                className={cn(
                  'relative size-14 overflow-hidden rounded-md border bg-muted',
                  p.status === 'error' && 'border-destructive',
                )}
              >
                {p.previewUrl ? (
                  <img src={p.previewUrl} alt={p.name} className="size-full object-cover" />
                ) : (
                  <span className="block truncate p-1 text-[10px]">{p.name}</span>
                )}
                {p.status === 'uploading' ? (
                  <span className="absolute inset-0 grid place-items-center bg-background/60">
                    <Loader2 className="size-4 animate-spin" aria-label={t('import.uploading')} />
                  </span>
                ) : null}
                <button
                  type="button"
                  className="absolute top-0.5 right-0.5 rounded-full bg-background/90 p-0.5 focus-visible:ring-2 focus-visible:ring-offset-3 focus-visible:ring-offset-background focus-visible:ring-ring focus-visible:outline-none"
                  aria-label={t('import.remove', { name: p.name })}
                  disabled={creating}
                  onClick={() => attachments.remove(p.id)}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <div
            className="flex flex-wrap gap-1.5"
            role="radiogroup"
            aria-label={t('import.grouping.label')}
          >
            {(['per_photo', 'one_product'] as const).map((g) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={attachment.grouping === g}
                disabled={creating}
                onClick={() => attachments.setGrouping(g)}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs focus-visible:ring-2 focus-visible:ring-offset-3 focus-visible:ring-offset-background focus-visible:ring-ring focus-visible:outline-none',
                  attachment.grouping === g
                    ? 'border-primary bg-primary-soft text-brand-text'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`import.grouping.${g}`)}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {creating ? (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          {attachment.kind === 'photos' ? t('import.readingPhotos') : t('import.reading')}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {t(error.key as never, error.values ?? {}) as string}
        </p>
      ) : null}
    </div>
  );
}
