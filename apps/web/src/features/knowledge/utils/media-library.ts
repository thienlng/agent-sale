import type { TrainingItemDto, UploadBotImageRequest } from '@agent-sales/contracts';

import { matchesText } from './table-data';

/** Pseudo-folder id for images that are not in any folder. */
export const UNCATEGORIZED = 'uncategorized';

/** Raw bytes allowed by `UploadBotImageRequest.base64` (≈1.4M base64 chars). */
export const MAX_IMAGE_BYTES = 1024 * 1024;
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageMimeType = UploadBotImageRequest['mimeType'];

export type FolderSort = 'newest' | 'oldest' | 'name';
export type FolderSummary = {
  id: string;
  name: string;
  /** null for the "uncategorized" pseudo-folder. */
  folder: TrainingItemDto | null;
  images: TrainingItemDto[];
  createdAt: string;
};

/**
 * Groups the bot's media items into folders. Images whose folder is missing (or that have
 * none) land in the uncategorized pseudo-folder, which only exists when it has images.
 */
export function summarizeLibrary(items: readonly TrainingItemDto[]): {
  folders: FolderSummary[];
  uncategorized: FolderSummary | null;
  imageCount: number;
} {
  const folders = new Map<string, FolderSummary>();
  for (const item of items)
    if (item.kind === 'media_folder')
      folders.set(item.id, {
        id: item.id,
        name: item.title,
        folder: item,
        images: [],
        createdAt: item.createdAt,
      });
  const loose: TrainingItemDto[] = [];
  let imageCount = 0;
  for (const item of items) {
    if (item.kind !== 'media') continue;
    imageCount++;
    const folder = item.folderId ? folders.get(item.folderId) : undefined;
    if (folder) folder.images.push(item);
    else loose.push(item);
  }
  return {
    folders: [...folders.values()],
    uncategorized: loose.length
      ? { id: UNCATEGORIZED, name: '', folder: null, images: loose, createdAt: '' }
      : null,
    imageCount,
  };
}

/** Folder grid: name search + sort. */
export function visibleFolders(
  folders: readonly FolderSummary[],
  query: string,
  sort: FolderSort,
): FolderSummary[] {
  const list = folders.filter((f) => matchesText(f.name, query));
  return list.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' });
    const diff = a.createdAt.localeCompare(b.createdAt);
    return sort === 'newest' ? -diff : diff;
  });
}

/** Client-side check before reading the file; `null` means the file can be uploaded. */
export function imageFileError(file: {
  type: string;
  size: number;
}): 'fileType' | 'fileSize' | null {
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return 'fileType';
  if (file.size > MAX_IMAGE_BYTES) return 'fileSize';
  return null;
}

/** File name without its extension, used as the default image title. */
export function titleFromFileName(name: string): string {
  return (name.replace(/\.[^.]+$/, '').trim() || name).slice(0, 160);
}

/** Base64 (no data-URL prefix) of raw bytes, chunked to stay under argument limits. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Base64 of the file, as the upload endpoint expects. */
export async function fileToBase64(file: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()));
}
