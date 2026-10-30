import { InvalidImageError } from './storage.errors.js';

export { InvalidImageError, MediaStorageUnavailableError } from './storage.errors.js';

export const DEFAULT_MAX_IMAGE_BYTES = 1_048_576;

/** Decode only canonical base64 and verify the actual file signature, not its extension. */
export function decodeImage(
  base64: string,
  mime: string,
  maxBytes = DEFAULT_MAX_IMAGE_BYTES,
): Uint8Array {
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > maxBytes || bytes.toString('base64') !== base64)
    throw new InvalidImageError(maxBytes);
  const png =
    mime === 'image/png' &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg =
    mime === 'image/jpeg' &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes.at(-2) === 255 &&
    bytes.at(-1) === 217;
  const webp =
    mime === 'image/webp' &&
    bytes.subarray(0, 4).toString() === 'RIFF' &&
    bytes.subarray(8, 12).toString() === 'WEBP';
  if (!png && !jpeg && !webp) throw new InvalidImageError(maxBytes);
  return bytes;
}
