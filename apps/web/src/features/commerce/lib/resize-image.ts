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

/** Scale (width, height) so the longest side is at most MAX_SIDE; never enlarges. */
export function fitWithin(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
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
 * Decode a picture in the browser, shrink it to at most 1600 px and re-encode it as JPEG
 * (transparency becomes white). Throws ImageUnreadableError for files the browser cannot decode.
 */
export async function resizeImage(file: Blob): Promise<ResizedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageUnreadableError();
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageUnreadableError();
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const encode = (quality: number) =>
      canvas.toDataURL('image/jpeg', quality).replace(/^data:[^,]*,/, '');
    let base64 = encode(QUALITY);
    if (decodedBytes(base64) > MAX_DECODED_BYTES) base64 = encode(RETRY_QUALITY);
    if (!base64) throw new ImageUnreadableError();
    return { mimeType: 'image/jpeg', base64 };
  } finally {
    bitmap.close();
  }
}
