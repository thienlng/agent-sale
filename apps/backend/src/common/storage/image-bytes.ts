import { InvalidImageError } from './storage.errors.js';

export { InvalidImageError, MediaStorageUnavailableError } from './storage.errors.js';

export const DEFAULT_MAX_IMAGE_BYTES = 1_048_576;

export const IMAGE_EXTENSIONS: Record<ImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

/** Which supported format the bytes really are (by signature, not by name or header), else null. */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255 && b.at(-2) === 255 && b.at(-1) === 217)
    return 'image/jpeg';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp';
  return null;
}

/** Bytes-based variant of `decodeImage` (server-side downloads): size limit + signature check. */
export function verifyImageBytes(bytes: Uint8Array, maxBytes = DEFAULT_MAX_IMAGE_BYTES): ImageMime {
  const mime = bytes.length && bytes.length <= maxBytes ? sniffImageMime(bytes) : null;
  if (!mime) throw new InvalidImageError(maxBytes);
  return mime;
}

/** Decode only canonical base64 and verify the actual file signature, not its extension. */
export function decodeImage(
  base64: string,
  mime: string,
  maxBytes = DEFAULT_MAX_IMAGE_BYTES,
): Uint8Array {
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > maxBytes || bytes.toString('base64') !== base64)
    throw new InvalidImageError(maxBytes);
  if (sniffImageMime(bytes) !== mime) throw new InvalidImageError(maxBytes);
  return bytes;
}
