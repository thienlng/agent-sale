import { z } from 'zod';

/**
 * Rapiz's own public objects (product pictures, bot library images, website chat uploads) are
 * stored and served as host-relative `/media/<key>` paths, so a change of public host (a new dev
 * tunnel, a domain move) never breaks them. Channels get an absolute URL built at send time.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/**
 * Exactly the keys Rapiz generates (uuid workspace, uuid file name), so a look-alike external URL
 * such as `https://cdn.shop.vn/media/products/villa-1.jpg` is never mistaken for ours:
 * product pictures `products/<ws>/<id>.jpg|png`, bot library images
 * `workspaces/<ws>/bots/<bot>/<id>.jpg|png|webp`, website chat uploads
 * `webchat/<ws>/<connection>/<id>.jpg|png|webp|gif`, lodging videos `lodging/<ws>/<id>.mp4`.
 */
const MEDIA_PATH = new RegExp(
  `^/media/(?:products/${UUID}/${UUID}\\.(?:jpe?g|png)` +
    `|workspaces/${UUID}/bots/${UUID}/${UUID}\\.(?:jpe?g|png|webp)` +
    `|webchat/${UUID}/${UUID}/${UUID}\\.(?:jpe?g|png|webp|gif)` +
    `|lodging/${UUID}/${UUID}\\.mp4)$`,
  'i',
);
const LODGING_VIDEO_PATH = new RegExp(`^/media/lodging/${UUID}/${UUID}\\.mp4$`, 'i');

/** True for a plain `/media/<key>` path of a Rapiz object (no traversal, query or encoding). */
export function isMediaPath(value: string): boolean {
  return MEDIA_PATH.test(value);
}

/** True for the `/media/lodging/<ws>/<id>.mp4` path of a video uploaded to a lodging gallery. */
export function isLodgingVideoPath(value: string): boolean {
  return LODGING_VIDEO_PATH.test(value);
}

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

/** A customer-facing picture: an https link or a stored Rapiz `/media/…` picture path (never a video). */
export const PublicImageUrl = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (v) => (isHttpsUrl(v) || isMediaPath(v)) && !isLodgingVideoPath(v),
    'must be an https link or a /media/ picture path',
  );

/** An https link (no http:, javascript: or data:), e.g. a YouTube or Drive video link. */
export const PublicHttpsUrl = z
  .string()
  .trim()
  .max(2000)
  .refine(isHttpsUrl, 'must be an https link');

/** A video uploaded through POST /lodging/media/videos, stored as its `/media/lodging/…` path. */
export const LodgingVideoPath = z
  .string()
  .trim()
  .max(2000)
  .refine(isLodgingVideoPath, 'must be a /media/lodging/ video path');
