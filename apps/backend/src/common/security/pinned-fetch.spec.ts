import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { pinnedFetch } from './pinned-fetch.js';

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

async function listen(handler: Parameters<typeof createServer>[1]): Promise<number> {
  server = createServer(handler);
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', () => r()));
  return (server.address() as AddressInfo).port;
}

const init = (address?: string) => ({
  signal: AbortSignal.timeout(5000),
  headers: { Accept: 'image/png' },
  redirect: 'manual' as const,
  address,
});

describe('pinnedFetch', () => {
  it('connects to the pinned address whatever the host name resolves to, keeping the Host header', async () => {
    let host = '';
    const port = await listen((req, res) => {
      host = req.headers.host ?? '';
      res.end('pinned');
    });
    // `.invalid` never resolves (RFC 2606): only the pinned address can make this succeed.
    const res = await pinnedFetch(new URL(`http://shop.invalid:${port}/a.png`), init('127.0.0.1'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('pinned');
    expect(host).toBe(`shop.invalid:${port}`);
  });

  it('does not follow redirects and exposes the Location header', async () => {
    const port = await listen((_req, res) => {
      res.writeHead(302, { location: 'https://elsewhere.test/x' });
      res.end();
    });
    const res = await pinnedFetch(new URL(`http://shop.invalid:${port}/`), init('127.0.0.1'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://elsewhere.test/x');
  });

  it('streams the body so the caller can cap it', async () => {
    const port = await listen((_req, res) => {
      res.write(Buffer.alloc(1024, 1));
      res.end(Buffer.alloc(1024, 2));
    });
    const res = await pinnedFetch(new URL(`http://shop.invalid:${port}/`), init('127.0.0.1'));
    const reader = res.body?.getReader();
    let total = 0;
    for (;;) {
      const chunk = await reader?.read();
      if (!chunk || chunk.done) break;
      total += chunk.value.byteLength;
    }
    expect(total).toBe(2048);
  });
});
