import { DomainError } from '@agent-sales/shared';

export class InvalidImageError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('Upload a PNG, JPEG or WebP image no larger than 1 MiB');
  }
}
export class MediaStorageUnavailableError extends DomainError {
  readonly code = 'UNAVAILABLE';
  constructor() {
    super('Bot image storage is not configured or is unavailable');
  }
}

/** Decode only canonical base64 and verify the actual file signature, not its extension. */
export function decodeImage(base64: string, mime: string): Uint8Array {
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > 1_048_576 || bytes.toString('base64') !== base64)
    throw new InvalidImageError();
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
  if (!png && !jpeg && !webp) throw new InvalidImageError();
  return bytes;
}
