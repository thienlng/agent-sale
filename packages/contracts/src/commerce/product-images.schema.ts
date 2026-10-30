import { z } from 'zod';

/** A product picture uploaded to Rapiz storage; the browser resizes it first (max 1 MiB decoded). */
export const UploadProductImageRequest = z.object({
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  base64: z
    .string()
    .min(1)
    .max(1_398_104)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export type UploadProductImageRequest = z.infer<typeof UploadProductImageRequest>;

export const UploadProductImageResponse = z.object({ url: z.url() });
export type UploadProductImageResponse = z.infer<typeof UploadProductImageResponse>;
