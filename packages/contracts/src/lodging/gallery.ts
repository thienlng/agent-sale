import { z } from 'zod';

import { LodgingVideoPath, PublicHttpsUrl, PublicImageUrl } from '../common/media.js';

/**
 * Lodging media folders (T-192, ADR-026): one level of folders per property, each holding photos,
 * uploaded MP4 videos and video links, in the owner's order. The bot sends a folder 8 photos at a
 * time (`BOT_ALBUM_PAGE_SIZE`).
 */
export const GALLERY_MAX_FOLDERS = 20;
/** Items of one property, every folder together. */
export const GALLERY_MAX_ITEMS = 200;
export const BOT_ALBUM_PAGE_SIZE = 8;
/** Largest MP4 the upload route accepts (Messenger's attachment limit is 25 MB too). */
export const LODGING_VIDEO_MAX_BYTES = 25 * 1024 * 1024;

const Caption = z.string().trim().max(300).default('');

/** A photo (product picture path or https link), an uploaded video, or an https video link. */
export const GalleryItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), url: PublicImageUrl, caption: Caption }),
  z.object({ kind: z.literal('video'), url: LodgingVideoPath, caption: Caption }),
  z.object({ kind: z.literal('link'), url: PublicHttpsUrl, caption: Caption }),
]);
export type GalleryItem = z.infer<typeof GalleryItem>;
export type GalleryItemKind = GalleryItem['kind'];

export const GalleryFolderId = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/);
export const GalleryFolder = z.object({
  id: GalleryFolderId,
  name: z.string().trim().min(1).max(100),
  items: z.array(GalleryItem).max(GALLERY_MAX_ITEMS),
});
export type GalleryFolder = z.infer<typeof GalleryFolder>;

/** Folder names compare trimmed and case-insensitively ("Phòng ngủ" = " phòng NGỦ "). */
export const folderNameKey = (name: string): string => name.trim().toLocaleLowerCase('vi');

/** A property's folders: at most 20, at most 200 items in all, unique ids and names. */
export const Gallery = z
  .array(GalleryFolder)
  .max(GALLERY_MAX_FOLDERS)
  .superRefine((folders, ctx) => {
    const total = folders.reduce((n, f) => n + f.items.length, 0);
    if (total > GALLERY_MAX_ITEMS)
      ctx.addIssue({
        code: 'custom',
        message: `at most ${GALLERY_MAX_ITEMS} items in all folders`,
      });
    const ids = new Set<string>();
    const names = new Set<string>();
    folders.forEach((f, i) => {
      if (ids.has(f.id))
        ctx.addIssue({ code: 'custom', path: [i, 'id'], message: 'folder ids must be unique' });
      if (names.has(folderNameKey(f.name)))
        ctx.addIssue({ code: 'custom', path: [i, 'name'], message: 'folder names must be unique' });
      ids.add(f.id);
      names.add(folderNameKey(f.name));
    });
  });

type MediaFolders = readonly { items: readonly { kind: string; url: string }[] }[];

/** True when `url` is the url of an image item of one of the folders. */
export function hasGalleryImage(gallery: MediaFolders, url: string): boolean {
  return gallery.some((f) => f.items.some((i) => i.kind === 'image' && i.url === url));
}

/**
 * The cover of a property: `galleryCover` when set, else the first image of the first folder that
 * has one; null without any image. Used by the web lists and the bot product.
 */
export function galleryCoverUrl(p: { gallery: MediaFolders; galleryCover: string }): string | null {
  if (p.galleryCover) return p.galleryCover;
  for (const folder of p.gallery) {
    const first = folder.items.find((i) => i.kind === 'image');
    if (first) return first.url;
  }
  return null;
}

/** Answer of POST /lodging/media/videos: the stored path and its size in bytes. */
export const UploadLodgingVideoResponse = z.object({
  url: LodgingVideoPath,
  bytes: z.number().int().positive().max(LODGING_VIDEO_MAX_BYTES),
});
export type UploadLodgingVideoResponse = z.infer<typeof UploadLodgingVideoResponse>;
