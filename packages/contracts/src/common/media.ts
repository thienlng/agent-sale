import { z } from 'zod';

/**
 * Rapiz's own public objects (product pictures, bot library images, website chat uploads) are
 * stored and served as host-relative `/media/<key>` paths, so a change of public host (a new dev
 * tunnel, a domain move) never breaks them. Channels get an absolute URL built at send time.
 */
const MEDIA_PATH = /^\/media\/(?:products|workspaces|webchat)(?:\/[\w-]+)+\.[A-Za-z0-9]+$/;

/** True for a plain `/media/<key>` path of a Rapiz object (no traversal, query or encoding). */
export function isMediaPath(value: string): boolean {
  return MEDIA_PATH.test(value);
}

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

/** A customer-facing picture: an https link or a stored Rapiz `/media/…` path. */
export const PublicImageUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => isHttpsUrl(v) || isMediaPath(v), 'must be an https link or a /media/ path');
