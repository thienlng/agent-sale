import { BlockList, isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import type { ImageInput } from '@agent-sales/ai-core';

import type { ImageFetcher } from '../../application/ports/image-fetcher.js';

export const MAX_IMAGE_BYTES = 3_000_000;
const TIMEOUT_MS = 5_000;

/** Hosts Meta serves Messenger / Instagram attachments from (checked 2026-10-24, not re-verified live). */
const HOST_SUFFIXES = ['.fbcdn.net', '.cdninstagram.com'];
const HOSTS = new Set(['lookaside.fbsbx.com', 'cdn.fbsbx.com']);

const PRIVATE = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  PRIVATE.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['64:ff9b::', 96],
] as const)
  PRIVATE.addSubnet(net, bits, 'ipv6');

export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped?.[1] ?? address;
  const family = isIP(ip);
  if (!family) return true;
  return PRIVATE.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

export function hostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  return HOSTS.has(h) || HOST_SUFFIXES.some((s) => h.endsWith(s) && h.length > s.length);
}

/** The declared type is trusted only when the bytes start like it. */
export function sniffImageType(bytes: Buffer): ImageInput['mimeType'] | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (
    bytes.length > 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * SSRF-safe downloader for customer images (Meta CDN links). https and a Meta CDN host allowlist
 * only; the connection is pinned to the validated DNS answer (no private/loopback address, no
 * rebinding window), redirects are failures, 5 s total, 3 MB streamed cap, content type re-checked
 * against the magic bytes. Never logs URLs or bytes and never persists anything.
 *
 * `extraHosts` (BOT_IMAGE_EXTRA_HOSTS, never set in production) lets tests use a local server:
 * those hosts skip the allowlist and the private-address block and may use plain http.
 */
export class SafeImageFetcher implements ImageFetcher {
  readonly #extra: ReadonlySet<string>;
  constructor(extraHosts: readonly string[] = []) {
    this.#extra = new Set(extraHosts.map((h) => h.toLowerCase()));
  }

  async fetch(rawUrl: string): Promise<ImageInput | null> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const extra = this.#extra.has(host);
    if (url.username || url.password) return null;
    if (url.protocol !== 'https:' && !(extra && url.protocol === 'http:')) return null;
    if (!extra && (!hostAllowed(host) || isIP(host))) return null;
    try {
      return await this.#download(url, host, extra);
    } catch {
      return null;
    }
  }

  #download(url: URL, host: string, extra: boolean): Promise<ImageInput | null> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (value: ImageInput | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        req.destroy();
        resolve(value);
      };
      // Node (24+) calls `lookup` with `{ all: true }` and expects a list; older callers expect one.
      const lookup = ((
        name: string,
        options: { all?: boolean } | undefined,
        callback: (
          err: Error | null,
          address: string | { address: string; family: number }[],
          family?: number,
        ) => void,
      ) => {
        dns.lookup(name, { all: true }, (err, addresses) => {
          const first = addresses?.[0];
          // Every answer must be public: a mixed answer could be a rebinding attempt.
          if (err || !first || (!extra && addresses.some((a) => isPrivateAddress(a.address))))
            return callback(err ?? new Error('blocked address'), '', 4);
          if (options?.all) return callback(null, addresses);
          callback(null, first.address, first.family);
        });
      }) as unknown as https.RequestOptions['lookup'];
      const transport = url.protocol === 'https:' ? https : http;
      const req = transport.request(
        {
          protocol: url.protocol,
          hostname: host,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: { Accept: 'image/jpeg,image/png,image/webp', 'Accept-Encoding': 'identity' },
          lookup,
          agent: false,
        },
        (res) => {
          const type = String(res.headers['content-type'] ?? '')
            .split(';')[0]
            ?.trim()
            .toLowerCase();
          const declared = Number(res.headers['content-length'] ?? 0);
          if (
            res.statusCode !== 200 ||
            !type ||
            !ALLOWED_TYPES.has(type) ||
            declared > MAX_IMAGE_BYTES
          )
            return finish(null);
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_IMAGE_BYTES) return finish(null);
            chunks.push(chunk);
          });
          res.on('error', () => finish(null));
          res.on('end', () => {
            const bytes = Buffer.concat(chunks);
            const sniffed = sniffImageType(bytes);
            finish(
              sniffed && sniffed === type
                ? { mimeType: sniffed, base64: bytes.toString('base64') }
                : null,
            );
          });
        },
      );
      const timer = setTimeout(() => finish(null), TIMEOUT_MS);
      req.on('error', () => finish(null));
      req.end();
    });
  }
}
