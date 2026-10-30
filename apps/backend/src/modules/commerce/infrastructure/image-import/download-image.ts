import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { verifyImageBytes, type ImageMime } from '../../../../common/storage/image-bytes.js';

export const IMPORT_MAX_BYTES = 10 * 1_048_576;
/** No WebP: Shopify-like CDNs would otherwise serve WebP, which Messenger rejects in albums. */
export const IMPORT_ACCEPT = 'image/jpeg,image/png;q=0.9,*/*;q=0.1';
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

export interface DownloadedImage {
  bytes: Uint8Array;
  mime: ImageMime;
}

/** Short, PII-free failure reason (never the body or the full URL). */
export class ImageDownloadError extends Error {}

export type HostResolver = (host: string) => Promise<string[]>;

export interface DownloadOptions {
  /** Resolves every address of a host; defaults to the system resolver. */
  resolve?: HostResolver;
  /** Internal, tests only: skip the private-address guard (never exposed as a CLI flag). */
  allowPrivateHosts?: boolean;
}

const systemResolve: HostResolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

function isBlockedV4(a: number[]): boolean {
  const [o1 = 0, o2 = 0] = a;
  return (
    o1 === 0 ||
    o1 === 10 ||
    o1 === 127 ||
    (o1 === 169 && o2 === 254) ||
    (o1 === 172 && o2 >= 16 && o2 <= 31) ||
    (o1 === 192 && o2 === 168)
  );
}

/** True for loopback, private, link-local, unique-local and unspecified addresses. */
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(ip) === 4) return isBlockedV4(ip.split('.').map(Number));
  if (isIP(ip) !== 6) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped?.[1]) return isBlockedV4(mapped[1].split('.').map(Number));
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hex?.[1] && hex[2]) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isBlockedV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  }
  if (ip === '::' || ip === '::1') return true;
  const first = parseInt(ip.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

async function assertPublicHost(hostname: string, resolve: HostResolver): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = await resolve(host);
    } catch {
      throw new ImageDownloadError('network_error');
    }
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress))
    throw new ImageDownloadError('blocked_address');
}

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

/** GET (public hosts only, checked on every hop) with a 15 s budget, at most 3 redirects, a 10 MiB cap and magic-byte verification. */
export async function downloadImage(
  url: string,
  fetchImpl: typeof fetch = fetch,
  options: DownloadOptions = {},
): Promise<DownloadedImage> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const target = new URL(current);
      if (target.protocol !== 'http:' && target.protocol !== 'https:')
        throw new ImageDownloadError('unsupported_scheme');
      if (!options.allowPrivateHosts)
        await assertPublicHost(target.hostname, options.resolve ?? systemResolve);
      const res = await fetchImpl(target, {
        redirect: 'manual',
        signal,
        headers: { Accept: IMPORT_ACCEPT },
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
      let mime: ImageMime;
      try {
        mime = verifyImageBytes(bytes, IMPORT_MAX_BYTES);
      } catch {
        throw new ImageDownloadError('not_an_image');
      }
      if (mime !== 'image/jpeg' && mime !== 'image/png')
        throw new ImageDownloadError('unsupported_format');
      return { bytes, mime };
    }
    throw new ImageDownloadError('too_many_redirects');
  } catch (e) {
    if (e instanceof ImageDownloadError) throw e;
    if (signal.aborted) throw new ImageDownloadError('timeout');
    throw new ImageDownloadError('network_error');
  }
}
