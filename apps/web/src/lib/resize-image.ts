/** Longest side of an uploaded picture, in pixels. */
export const MAX_SIDE = 1600;
const QUALITY = 0.85;
const RETRY_QUALITY = 0.7;
/** Decoded size the server accepts per picture. */
const MAX_DECODED_BYTES = 1024 * 1024;

export class ImageUnreadableError extends Error {
  constructor() {
    super('IMAGE_UNREADABLE');
    this.name = 'ImageUnreadableError';
  }
}

/** Longest side of the thumbnail a vision call gets (assistant photo import). */
export const THUMBNAIL_SIDE = 512;
const THUMBNAIL_QUALITY = 0.8;
const THUMBNAIL_RETRY_QUALITY = 0.6;
/** Base64 length the assistant import accepts per thumbnail (contracts IMPORT_MAX_THUMBNAIL_BASE64). */
const MAX_THUMBNAIL_BASE64 = 204_800;

/** Scale (width, height) so the longest side is at most `maxSide`; never enlarges. */
export function fitWithin(
  width: number,
  height: number,
  maxSide = MAX_SIDE,
): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Bytes behind a plain base64 string. */
export function decodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export interface ResizedImage {
  mimeType: 'image/jpeg';
  base64: string;
}

/**
 * Decode a picture, draw it at most `maxSide` px on white and return a JPEG encoder for it.
 * Throws ImageUnreadableError for files the browser cannot decode.
 */
async function drawJpeg<T>(
  file: Blob,
  maxSide: number,
  use: (encode: (quality: number) => string) => T,
): Promise<T> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageUnreadableError();
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageUnreadableError();
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return use((quality) => canvas.toDataURL('image/jpeg', quality).replace(/^data:[^,]*,/, ''));
  } finally {
    bitmap.close();
  }
}

/**
 * Decode a picture in the browser, shrink it to at most 1600 px and re-encode it as JPEG
 * (transparency becomes white). Throws ImageUnreadableError for files the browser cannot decode.
 */
export function resizeImage(file: Blob): Promise<ResizedImage> {
  return drawJpeg(file, MAX_SIDE, (encode) => {
    let base64 = encode(QUALITY);
    if (decodedBytes(base64) > MAX_DECODED_BYTES) base64 = encode(RETRY_QUALITY);
    if (!base64) throw new ImageUnreadableError();
    return { mimeType: 'image/jpeg' as const, base64 };
  });
}

/**
 * A small JPEG of the picture for the assistant's vision call (photo import): at most `maxSide`
 * px, re-encoded at a lower quality when it would be over the import's thumbnail limit.
 */
export function thumbnail(
  file: Blob,
  maxSide = THUMBNAIL_SIDE,
  quality = THUMBNAIL_QUALITY,
): Promise<ResizedImage> {
  return drawJpeg(file, maxSide, (encode) => {
    let base64 = encode(quality);
    if (base64.length > MAX_THUMBNAIL_BASE64) base64 = encode(THUMBNAIL_RETRY_QUALITY);
    if (!base64 || base64.length > MAX_THUMBNAIL_BASE64) throw new ImageUnreadableError();
    return { mimeType: 'image/jpeg' as const, base64 };
  });
}
