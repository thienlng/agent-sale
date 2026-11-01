import { z } from 'zod';

import { PublicImageUrl } from '../common/media.js';

/**
 * A product picture uploaded to Rapiz storage; the browser resizes it first (max 1 MiB decoded).
 * JPEG or PNG only: Messenger rejects WebP inside multi-image albums (#-1 / 2018012), so
 * product pictures are never stored as WebP (the web converts WebP files to JPEG).
 */
export const UploadProductImageRequest = z.object({
  mimeType: z.enum(['image/png', 'image/jpeg']),
  base64: z
    .string()
    .min(1)
    .max(1_398_104)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export type UploadProductImageRequest = z.infer<typeof UploadProductImageRequest>;

/** `url` is the stored picture's host-relative `/media/…` path. */
export const UploadProductImageResponse = z.object({ url: PublicImageUrl });
export type UploadProductImageResponse = z.infer<typeof UploadProductImageResponse>;
