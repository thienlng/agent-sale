/**
 * Fetches a PMS picture with the import rules (public hosts only, 10 MiB, JPEG/PNG only).
 * Throws ExternalImageError with a short reason.
 */
export type ExternalImageDownloader = (
  url: string,
) => Promise<{ bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' }>;

export const EXTERNAL_IMAGE_DOWNLOADER = Symbol('EXTERNAL_IMAGE_DOWNLOADER');
