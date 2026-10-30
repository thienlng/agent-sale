import { verifyImageBytes, type ImageMime } from '../../../../common/storage/image-bytes.js';

export const IMPORT_MAX_BYTES = 10 * 1_048_576;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

export interface DownloadedImage {
  bytes: Uint8Array;
  mime: ImageMime;
}

/** Short, PII-free failure reason (never the body or the full URL). */
export class ImageDownloadError extends Error {}

async function readLimited(res: Response): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > IMPORT_MAX_BYTES) throw new ImageDownloadError('too_large');
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  if (!reader) throw new ImageDownloadError('empty');
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > IMPORT_MAX_BYTES) {
      await reader.cancel();
      throw new ImageDownloadError('too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** GET with a 15 s budget, at most 3 redirects, a 10 MiB cap and magic-byte verification. */
export async function downloadImage(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DownloadedImage> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const target = new URL(current);
      if (target.protocol !== 'http:' && target.protocol !== 'https:')
        throw new ImageDownloadError('unsupported_scheme');
      const res = await fetchImpl(target, {
        redirect: 'manual',
        signal,
        headers: { Accept: 'image/jpeg,image/png,image/webp' },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.body?.cancel();
        if (!location) throw new ImageDownloadError(`http_${res.status}`);
        current = new URL(location, target).toString();
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new ImageDownloadError(`http_${res.status}`);
      }
      const bytes = await readLimited(res);
      try {
        return { bytes, mime: verifyImageBytes(bytes, IMPORT_MAX_BYTES) };
      } catch {
        throw new ImageDownloadError('not_an_image');
      }
    }
    throw new ImageDownloadError('too_many_redirects');
  } catch (e) {
    if (e instanceof ImageDownloadError) throw e;
    if (signal.aborted) throw new ImageDownloadError('timeout');
    throw new ImageDownloadError('network_error');
  }
}
