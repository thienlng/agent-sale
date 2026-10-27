export type UploadMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export const UPLOAD_EXTENSIONS: Record<UploadMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** The image type of `bytes` judged from the file signature only; the declared type is never trusted. */
export function sniffUpload(bytes: Uint8Array): UploadMime | null {
  const at = (i: number) => bytes[i];
  const ascii = (from: number, to: number) =>
    Buffer.from(bytes.subarray(from, to)).toString('latin1');
  if (bytes.length > 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (
    bytes.length > 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)
  )
    return 'image/png';
  if (bytes.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length > 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a'))
    return 'image/gif';
  return null;
}
