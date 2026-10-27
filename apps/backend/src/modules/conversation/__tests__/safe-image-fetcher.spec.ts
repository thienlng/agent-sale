import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  hostAllowed,
  isPrivateAddress,
  SafeImageFetcher,
  sniffImageType,
} from '../infrastructure/media/safe-image-fetcher.js';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(40),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);

describe('address and host rules', () => {
  it('blocks private, loopback, link-local and mapped addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.0.9',
      '172.20.0.1',
      '169.254.169.254',
      '0.0.0.0',
      '100.64.0.1',
      '::1',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      'not-an-ip',
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '31.13.80.1', '2a03:2880::1'])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it('allows only Meta CDN hosts', () => {
    for (const h of [
      'scontent-sin6-1.xx.fbcdn.net',
      'a.cdninstagram.com',
      'lookaside.fbsbx.com',
      'cdn.fbsbx.com',
    ])
      expect(hostAllowed(h), h).toBe(true);
    for (const h of [
      'fbcdn.net',
      'evil.com',
      'fbcdn.net.evil.com',
      'xfbcdn.net',
      'localhost',
      'other.fbsbx.com',
    ])
      expect(hostAllowed(h), h).toBe(false);
  });
  it('sniffs types from magic bytes', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('GIF89a....'))).toBeNull();
  });
});

describe('SafeImageFetcher', () => {
  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const send = (
        status: number,
        type: string,
        body: Buffer,
        extra: Record<string, string> = {},
      ) => {
        res.writeHead(status, { 'Content-Type': type, ...extra });
        res.end(body);
      };
      if (req.url === '/ok.png') return send(200, 'image/png', PNG);
      if (req.url === '/lie.png') return send(200, 'image/png', Buffer.from('<html>no</html>'));
      if (req.url === '/type.png') return send(200, 'text/html', PNG);
      if (req.url === '/mismatch') return send(200, 'image/jpeg', PNG);
      if (req.url === '/redirect')
        return send(302, 'text/plain', Buffer.alloc(0), { Location: '/ok.png' });
      if (req.url === '/big.png')
        return send(200, 'image/png', Buffer.concat([PNG, Buffer.alloc(3_100_000)]));
      if (req.url === '/slow.png') return; // never answers
      send(404, 'text/plain', Buffer.alloc(0));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it('downloads an image from an extra host', async () => {
    const result = await new SafeImageFetcher(['127.0.0.1']).fetch(`${base}/ok.png`);
    expect(result).toEqual({ mimeType: 'image/png', base64: PNG.toString('base64') });
  });
  it('resolves a host name through its own DNS check (Node asks for all addresses)', async () => {
    const port = (server.address() as AddressInfo).port;
    const result = await new SafeImageFetcher(['localhost']).fetch(
      `http://localhost:${port}/ok.png`,
    );
    expect(result).toEqual({ mimeType: 'image/png', base64: PNG.toString('base64') });
  });
  it('refuses loopback and unlisted hosts without extra hosts, and plain http', async () => {
    const fetcher = new SafeImageFetcher();
    expect(await fetcher.fetch(`${base}/ok.png`)).toBeNull();
    expect(await fetcher.fetch('https://example.com/a.png')).toBeNull();
    expect(await fetcher.fetch('http://scontent.xx.fbcdn.net/a.png')).toBeNull();
    expect(await fetcher.fetch('https://user:pw@scontent.xx.fbcdn.net/a.png')).toBeNull();
    expect(await fetcher.fetch('https://[::1]/a.png')).toBeNull();
    expect(await fetcher.fetch('not a url')).toBeNull();
  });
  it('fails closed on bad responses', async () => {
    const fetcher = new SafeImageFetcher(['127.0.0.1']);
    for (const path of ['/lie.png', '/type.png', '/mismatch', '/redirect', '/big.png', '/missing'])
      expect(await fetcher.fetch(`${base}${path}`), path).toBeNull();
  });
  it('gives up on a response that never arrives', async () => {
    const started = Date.now();
    expect(await new SafeImageFetcher(['127.0.0.1']).fetch(`${base}/slow.png`)).toBeNull();
    expect(Date.now() - started).toBeLessThan(7_000);
  }, 10_000);
});
describe('SafeImageFetcher public upload hosts (T-100)', () => {
  it('allows a configured public host only over https and never an IP literal', async () => {
    const fetcher = new SafeImageFetcher([], ['cdn.rapiz.test']);
    expect(await fetcher.fetch('http://cdn.rapiz.test/a.png')).toBeNull();
    expect(
      await new SafeImageFetcher([], ['127.0.0.1']).fetch('https://127.0.0.1/a.png'),
    ).toBeNull();
  });
});
