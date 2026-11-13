import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { isPublicAddress } from '../../../../common/security/ip-guard.js';
import { pinnedFetch, type PinnedFetch } from '../../../../common/security/pinned-fetch.js';
import { verifyImageBytes, type ImageMime } from '../../../../common/storage/image-bytes.js';
import { ExternalImageError } from '../../api/catalog-sync.facade.js';
import type { ExternalImageDownloader } from '../../application/ports/external-image-downloader.js';

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

/**
 * True for every address an import must not reach: loopback, private, link-local (cloud
 * metadata), CGNAT, reserved, multicast, documentation ranges and their IPv4-mapped forms.
 * Delegates to the shared guard of the action executor (`common/security/ip-guard.ts`).
 */
export function isBlockedAddress(address: string): boolean {
  let ip = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(ip) === 6) {
    try {
      // Canonical compressed form: long spellings of :: and ::1, mixed IPv4-mapped notation.
      ip = new URL(`http://[${ip}]`).hostname.replace(/^\[|\]$/g, '');
    } catch {
      return true;
    }
  }
  return !isPublicAddress(ip);
}

/**
 * Resolves the hop's host once and returns the address to connect to. Every address must be
 * public (a mixed answer is refused), IPv4 is preferred; the connection is then pinned to it.
 */
async function publicAddressOf(hostname: string, resolve: HostResolver): Promise<string> {
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
  return addresses.find((a) => isIP(a) === 4) ?? (addresses[0] as string);
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

/**
 * GET with a 15 s budget, at most 3 redirects, a 10 MiB cap and magic-byte verification. Every
 * hop must be https on the default port and resolve only to public addresses; the connection is
 * pinned to the address that was checked, so DNS rebinding cannot swap the target (security
 * audit R1). `fetchImpl` is for tests; production uses the pinned node:https client.
 */
export async function downloadImage(
  url: string,
  fetchImpl: PinnedFetch = pinnedFetch,
  options: DownloadOptions = {},
): Promise<DownloadedImage> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const target = new URL(current);
      if (target.protocol !== 'http:' && target.protocol !== 'https:')
        throw new ImageDownloadError('unsupported_scheme');
      if (target.username || target.password) throw new ImageDownloadError('blocked_address');
      let address: string | undefined;
      if (!options.allowPrivateHosts) {
        if (target.protocol !== 'https:') throw new ImageDownloadError('insecure_scheme');
        if (target.port !== '' && target.port !== '443')
          throw new ImageDownloadError('blocked_port');
        address = await publicAddressOf(target.hostname, options.resolve ?? systemResolve);
      }
      const res = await fetchImpl(target, {
        redirect: 'manual',
        signal,
        headers: { Accept: IMPORT_ACCEPT },
        address,
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

/** `downloadImage` for the PMS sync: JPEG/PNG only, failures as ExternalImageError(reason). */
export const downloadExternalImage: ExternalImageDownloader = async (url) => {
  try {
    const { bytes, mime } = await downloadImage(url);
    // downloadImage already refuses everything else; this narrows the type.
    if (mime !== 'image/jpeg' && mime !== 'image/png')
      throw new ExternalImageError('unsupported_format');
    return { bytes, mime };
  } catch (e) {
    if (e instanceof ImageDownloadError) throw new ExternalImageError(e.message);
    throw e;
  }
};
