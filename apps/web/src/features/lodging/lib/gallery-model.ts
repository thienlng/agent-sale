import {
  folderNameKey,
  GALLERY_MAX_FOLDERS,
  GALLERY_MAX_ITEMS,
  galleryCoverUrl,
  type GalleryFolder,
  type GalleryItem,
} from '@agent-sales/contracts';

/** The "Ảnh & video" tab's editable copy: every folder plus the chosen cover, saved together. */
export interface GalleryDraft {
  gallery: GalleryFolder[];
  galleryCover: string;
}

/** Stores one picked image file and resolves to its URL; passed in by the route (commerce upload). */
export type GalleryImageUpload = (file: File) => Promise<string>;

/** An upload failure whose message is already translated for the owner. */
export class GalleryUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GalleryUploadError';
  }
}

export const cloneGallery = (gallery: readonly GalleryFolder[]): GalleryFolder[] =>
  gallery.map((f) => ({ ...f, items: f.items.map((i) => ({ ...i })) }));
export const totalItems = (d: GalleryDraft): number =>
  d.gallery.reduce((n, f) => n + f.items.length, 0);
export const remainingItems = (d: GalleryDraft): number =>
  Math.max(0, GALLERY_MAX_ITEMS - totalItems(d));
export const canAddFolder = (d: GalleryDraft): boolean => d.gallery.length < GALLERY_MAX_FOLDERS;
export const coverOf = (d: GalleryDraft): string | null => galleryCoverUrl(d);

/** True when another folder already has this name (trimmed, case-insensitive, like the API). */
export function nameTaken(d: GalleryDraft, name: string, exceptId?: string): boolean {
  const key = folderNameKey(name);
  return d.gallery.some((f) => f.id !== exceptId && folderNameKey(f.name) === key);
}

/** A chosen cover stays only while it is still an image of some folder (the API checks it). */
function keepCover(d: GalleryDraft): GalleryDraft {
  if (!d.galleryCover) return d;
  const still = d.gallery.some((f) =>
    f.items.some((i) => i.kind === 'image' && i.url === d.galleryCover),
  );
  return still ? d : { ...d, galleryCover: '' };
}

const mapFolder = (
  d: GalleryDraft,
  id: string,
  fn: (f: GalleryFolder) => GalleryFolder,
): GalleryDraft => ({ ...d, gallery: d.gallery.map((f) => (f.id === id ? fn(f) : f)) });

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return next;
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

export function addFolder(
  d: GalleryDraft,
  name: string,
  id: string = crypto.randomUUID(),
): GalleryDraft {
  if (!canAddFolder(d) || !name.trim() || nameTaken(d, name)) return d;
  return { ...d, gallery: [...d.gallery, { id, name: name.trim(), items: [] }] };
}

export function renameFolder(d: GalleryDraft, id: string, name: string): GalleryDraft {
  if (!name.trim() || nameTaken(d, name, id)) return d;
  return mapFolder(d, id, (f) => ({ ...f, name: name.trim() }));
}

export function moveFolder(d: GalleryDraft, id: string, delta: -1 | 1): GalleryDraft {
  const from = d.gallery.findIndex((f) => f.id === id);
  return { ...d, gallery: moved(d.gallery, from, from + delta) };
}

export function deleteFolder(d: GalleryDraft, id: string): GalleryDraft {
  return keepCover({ ...d, gallery: d.gallery.filter((f) => f.id !== id) });
}

/** Appends to the end of a folder, cut to what the property may still hold (200 in all). */
export function appendItems(
  d: GalleryDraft,
  folderId: string,
  items: readonly GalleryItem[],
): GalleryDraft {
  const room = remainingItems(d);
  if (!room || !items.length) return d;
  return mapFolder(d, folderId, (f) => ({ ...f, items: [...f.items, ...items.slice(0, room)] }));
}

export function reorderItems(
  d: GalleryDraft,
  folderId: string,
  from: number,
  to: number,
): GalleryDraft {
  return mapFolder(d, folderId, (f) => ({ ...f, items: moved(f.items, from, to) }));
}

export function moveItem(
  d: GalleryDraft,
  folderId: string,
  index: number,
  delta: -1 | 1,
): GalleryDraft {
  return reorderItems(d, folderId, index, index + delta);
}

/** Moves the items at `indexes` to the end of another folder, keeping their order. */
export function moveItemsTo(
  d: GalleryDraft,
  fromId: string,
  indexes: readonly number[],
  toId: string,
): GalleryDraft {
  const source = d.gallery.find((f) => f.id === fromId);
  if (!source || fromId === toId || !d.gallery.some((f) => f.id === toId)) return d;
  const picked = new Set(indexes);
  const moving = source.items.filter((_, i) => picked.has(i));
  return {
    ...d,
    gallery: d.gallery.map((f) =>
      f.id === fromId
        ? { ...f, items: f.items.filter((_, i) => !picked.has(i)) }
        : f.id === toId
          ? { ...f, items: [...f.items, ...moving] }
          : f,
    ),
  };
}

export function removeItems(
  d: GalleryDraft,
  folderId: string,
  indexes: readonly number[],
): GalleryDraft {
  const picked = new Set(indexes);
  return keepCover(
    mapFolder(d, folderId, (f) => ({ ...f, items: f.items.filter((_, i) => !picked.has(i)) })),
  );
}

export function setCaption(
  d: GalleryDraft,
  folderId: string,
  index: number,
  caption: string,
): GalleryDraft {
  return mapFolder(d, folderId, (f) => ({
    ...f,
    items: f.items.map((item, i) =>
      i === index ? { ...item, caption: caption.slice(0, 300) } : item,
    ),
  }));
}

export function setCover(d: GalleryDraft, url: string): GalleryDraft {
  return { ...d, galleryCover: url };
}

export function folderCounts(f: GalleryFolder): { images: number; videos: number; links: number } {
  return {
    images: f.items.filter((i) => i.kind === 'image').length,
    videos: f.items.filter((i) => i.kind === 'video').length,
    links: f.items.filter((i) => i.kind === 'link').length,
  };
}

export const folderThumb = (f: GalleryFolder): string | null =>
  f.items.find((i) => i.kind === 'image')?.url ?? null;

/** 1-based number of each photo (only photos are sent page by page); null for videos and links. */
export function imageNumbers(items: readonly GalleryItem[]): (number | null)[] {
  let n = 0;
  return items.map((i) => (i.kind === 'image' ? ++n : null));
}

/** Stable sortable ids: the url, with `#k` when the same url appears again. */
export function itemKeys(items: readonly GalleryItem[]): string[] {
  const seen = new Map<string, number>();
  return items.map((i) => {
    const k = seen.get(i.url) ?? 0;
    seen.set(i.url, k + 1);
    return k ? `${i.url}#${k}` : i.url;
  });
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
