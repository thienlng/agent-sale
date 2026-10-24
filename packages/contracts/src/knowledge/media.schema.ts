import { z } from 'zod';

export const UploadBotImageRequest = z.object({
  title: z.string().trim().min(1).max(160),
  fileName: z.string().trim().min(1).max(120),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  base64: z
    .string()
    .min(1)
    .max(1_398_104)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  /** Optional `media_folder` item to put the image in. */
  folderId: z.uuid().nullable().default(null),
});
export type UploadBotImageRequest = z.infer<typeof UploadBotImageRequest>;
