import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSafeHttp,
  SafeHttpTransportError,
  type SafeHttpTransport,
} from '../domain/safe-http.js';

const okTransport = (body = '{"ok":true}', status = 200): SafeHttpTransport =>
  vi.fn(async () => ({ status, body }));

const req = (url: string, extra: object = {}) => ({
  url,
  method: 'GET',
  headers: {},
  ...extra,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createSafeHttp (injected resolver/transport)', () => {
  it('returns parsed JSON and status for a public https host', async () => {
    const transport = okTransport('{"a":1}');
    const http = createSafeHttp({ resolve: async () => ['93.184.216.34'], transport });
    await expect(http(req('https://shop.example.com/orders/1'))).resolves.toEqual({
      ok: true,
      status: 200,
      json: { a: 1 },
    });
  });

  it('connects to the validated IP and resolves DNS exactly once (rebinding safe)', async () => {
    const resolve = vi
      .fn<(h: string) => Promise<string[]>>()
      .mockResolvedValueOnce(['93.184.216.34'])
      .mockResolvedValue(['127.0.0.1']);
    const transport = okTransport();
    const http = createSafeHttp({ resolve, transport });
    await http(req('https://shop.example.com/x'));
    expect(resolve).toHaveBeenCalledTimes(1);
    const call = vi.mocked(transport).mock.calls[0]?.[0];
    expect(call?.address).toBe('93.184.216.34');
    expect(call?.url.hostname).toBe('shop.example.com');
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['rfc1918 10/8', '10.1.2.3'],
    ['rfc1918 172.16/12', '172.20.0.1'],
    ['rfc1918 192.168/16', '192.168.0.10'],
    ['cgnat', '100.64.1.1'],
    ['metadata', '169.254.169.254'],
    ['unspecified', '0.0.0.0'],
    ['v6 loopback', '::1'],
    ['v6 unique local', 'fc00::5'],
    ['v6 link local', 'fe80::1'],
    ['v6 multicast', 'ff02::1'],
    ['v4-mapped loopback', '::ffff:127.0.0.1'],
    ['v4-mapped loopback hex', '::ffff:7f00:1'],
  ])('blocks a hostname resolving to %s', async (_n, ip) => {
    const transport = okTransport();
    const http = createSafeHttp({ resolve: async () => [ip], transport });
    await expect(http(req('https://evil.example.com/'))).resolves.toEqual({
      ok: false,
      errorCode: 'blocked_host',
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('blocks when any one resolved address is non-public', async () => {
    const transport = okTransport();
    const http = createSafeHttp({
      resolve: async () => ['93.184.216.34', '10.0.0.5'],
      transport,
    });
    expect(await http(req('https://mixed.example.com/'))).toEqual({
      ok: false,
      errorCode: 'blocked_host',
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:7f00:1]/',
    'https://2130706433/',
    'https://0x7f.0.0.1/',
    'https://0177.0.0.1/',
    'https://127.1/',
    'https://169.254.169.254/latest/meta-data',
  ])('blocks IP-literal or obfuscated host %s without trusting the resolver', async (url) => {
    const resolve = vi.fn(async () => ['93.184.216.34']);
    const transport = okTransport();
    const http = createSafeHttp({ resolve, transport });
    expect(await http(req(url))).toEqual({ ok: false, errorCode: 'blocked_host' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects http: for hosts outside the allowlist', async () => {
    const transport = okTransport();
    const http = createSafeHttp({ resolve: async () => ['93.184.216.34'], transport });
    expect(await http(req('http://shop.example.com/'))).toEqual({
      ok: false,
      errorCode: 'blocked_host',
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects other schemes, credentials in the URL and invalid URLs', async () => {
    const http = createSafeHttp({
      resolve: async () => ['93.184.216.34'],
      transport: okTransport(),
    });
    for (const url of [
      'ftp://shop.example.com/',
      'file:///etc/passwd',
      'https://u:p@shop.example.com/',
      'not a url',
    ]) {
      expect(await http(req(url))).toEqual({ ok: false, errorCode: 'blocked_host' });
    }
  });

  it('allows http (and skips the IP guard) only for allowlisted hosts', async () => {
    const transport = okTransport();
    const http = createSafeHttp({
      resolve: async () => ['127.0.0.1'],
      transport,
      allowHttpHosts: ['localhost'],
    });
    expect((await http(req('http://localhost:4000/orders'))).ok).toBe(true);
    expect(vi.mocked(transport).mock.calls[0]?.[0].address).toBe('127.0.0.1');
    expect(await http(req('http://other.example.com/'))).toEqual({
      ok: false,
      errorCode: 'blocked_host',
    });
  });

  it('never follows redirects: 3xx becomes bad_status', async () => {
    const transport = okTransport('', 302);
    const http = createSafeHttp({ resolve: async () => ['93.184.216.34'], transport });
    expect(await http(req('https://shop.example.com/r'))).toEqual({
      ok: false,
      errorCode: 'bad_status',
      status: 302,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('returns non-2xx JSON responses as results so the caller can match declared statuses', async () => {
    const http = createSafeHttp({
      resolve: async () => ['93.184.216.34'],
      transport: okTransport('{"error":"nope"}', 404),
    });
    expect(await http(req('https://shop.example.com/x'))).toEqual({
      ok: true,
      status: 404,
      json: { error: 'nope' },
    });
  });

  it('maps a non-JSON body to bad_status', async () => {
    const http = createSafeHttp({
      resolve: async () => ['93.184.216.34'],
      transport: okTransport('<html>oops</html>'),
    });
    expect(await http(req('https://shop.example.com/x'))).toEqual({
      ok: false,
      errorCode: 'bad_status',
      status: 200,
    });
  });

  it('treats an empty body as null JSON', async () => {
    const http = createSafeHttp({
      resolve: async () => ['93.184.216.34'],
      transport: okTransport('', 204),
    });
    expect(await http(req('https://shop.example.com/x'))).toEqual({
      ok: true,
      status: 204,
      json: null,
    });
  });

  it('maps an oversize body (even from a lax transport) to too_large', async () => {
    const http = createSafeHttp({
      resolve: async () => ['93.184.216.34'],
      transport: okTransport(`"${'a'.repeat(256 * 1024)}"`),
    });
    expect(await http(req('https://shop.example.com/x'))).toEqual({
      ok: false,
      errorCode: 'too_large',
    });
  });

  it('maps transport too_large and network errors to categories only', async () => {
    const make = (code: 'too_large' | 'network' | 'timeout'): SafeHttpTransport =>
      vi.fn(async () => {
        throw new SafeHttpTransportError(code, 'secret detail https://x.example/?token=abc');
      });
    for (const code of ['too_large', 'network', 'timeout'] as const) {
      const http = createSafeHttp({
        resolve: async () => ['93.184.216.34'],
        transport: make(code),
      });
      const result = await http(req('https://shop.example.com/x'));
      expect(result).toEqual({ ok: false, errorCode: code });
    }
  });

  it('maps unknown transport errors and resolver failures to network', async () => {
    const boom: SafeHttpTransport = async () => {
      throw new Error('ECONNRESET https://x.example/?token=abc');
    };
    const http = createSafeHttp({ resolve: async () => ['93.184.216.34'], transport: boom });
    expect(await http(req('https://shop.example.com/x'))).toEqual({
      ok: false,
      errorCode: 'network',
    });
    const http2 = createSafeHttp({
      resolve: async () => {
        throw new Error('ENOTFOUND');
      },
      transport: okTransport(),
    });
    expect(await http2(req('https://nowhere.example.com/'))).toEqual({
      ok: false,
      errorCode: 'network',
    });
    const http3 = createSafeHttp({ resolve: async () => [], transport: okTransport() });
    expect(await http3(req('https://empty.example.com/'))).toEqual({
      ok: false,
      errorCode: 'network',
    });
  });

  it('times out after 8 seconds and aborts the transport', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const transport: SafeHttpTransport = (r) =>
      new Promise((_res, rej) => {
        r.signal.addEventListener('abort', () => {
          aborted = true;
          rej(new Error('aborted'));
        });
      });
    const http = createSafeHttp({ resolve: async () => ['93.184.216.34'], transport });
    const pending = http(req('https://shop.example.com/slow'));
    await vi.advanceTimersByTimeAsync(7_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, errorCode: 'timeout' });
    expect(aborted).toBe(true);
  });

  it('passes method, headers and body to the transport untouched', async () => {
    const transport = okTransport();
    const http = createSafeHttp({ resolve: async () => ['93.184.216.34'], transport });
    await http({
      url: 'https://shop.example.com/b?x=1',
      method: 'POST',
      headers: { 'Idempotency-Key': 'k' },
      body: '{"a":1}',
    });
    const call = vi.mocked(transport).mock.calls[0]?.[0];
    expect(call).toMatchObject({
      method: 'POST',
      headers: { 'Idempotency-Key': 'k' },
      body: '{"a":1}',
      maxBytes: 256 * 1024,
    });
    expect(`${call?.url.pathname ?? ''}${call?.url.search ?? ''}`).toBe('/b?x=1');
  });
});

describe('createSafeHttp (real socket, local server via allowlist)', () => {
  let server: Server | undefined;

  const start = async (handler: Parameters<typeof createServer>[1]): Promise<string> => {
    server = createServer(handler);
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  };

  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = undefined;
  });

  it('is blocked without the explicit allowlist', async () => {
    const base = await start((_q, res) => res.end('{}'));
    const http = createSafeHttp({ allowHttpHosts: [] });
    expect(await http(req(`${base}/`))).toEqual({ ok: false, errorCode: 'blocked_host' });
  });

  it('fetches JSON over a real socket', async () => {
    const base = await start((q, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ method: q.method, key: q.headers['idempotency-key'] }));
    });
    const http = createSafeHttp({ allowHttpHosts: ['127.0.0.1'] });
    expect(
      await http({
        url: `${base}/o`,
        method: 'POST',
        headers: { 'Idempotency-Key': 'k1' },
        body: '{}',
      }),
    ).toEqual({ ok: true, status: 200, json: { method: 'POST', key: 'k1' } });
  });

  it('does not follow a redirect to an internal address', async () => {
    let hits = 0;
    const base = await start((q, res) => {
      hits += 1;
      if (q.url === '/r') {
        res.statusCode = 302;
        res.setHeader('location', '/final');
        res.end();
      } else res.end('{}');
    });
    const http = createSafeHttp({ allowHttpHosts: ['127.0.0.1'] });
    expect(await http(req(`${base}/r`))).toEqual({
      ok: false,
      errorCode: 'bad_status',
      status: 302,
    });
    expect(hits).toBe(1);
  });

  it('aborts a streamed oversize body with too_large', async () => {
    let destroyed = false;
    const base = await start((_q, res) => {
      res.on('close', () => (destroyed = true));
      res.write('{"a":"');
      const t = setInterval(() => res.write('x'.repeat(64 * 1024)), 5);
      res.on('close', () => clearInterval(t));
    });
    const http = createSafeHttp({ allowHttpHosts: ['127.0.0.1'] });
    expect(await http(req(`${base}/huge`))).toEqual({ ok: false, errorCode: 'too_large' });
    await vi.waitFor(() => expect(destroyed).toBe(true));
  });

  it('rejects an oversize declared content-length', async () => {
    const base = await start((_q, res) => {
      res.setHeader('content-length', String(10 * 1024 * 1024));
      res.write('{');
    });
    const http = createSafeHttp({ allowHttpHosts: ['127.0.0.1'] });
    expect(await http(req(`${base}/`))).toEqual({ ok: false, errorCode: 'too_large' });
  });

  it('times out on a server that never answers', async () => {
    const base = await start(() => undefined);
    const http = createSafeHttp({ allowHttpHosts: ['127.0.0.1'], timeoutMs: 150 });
    expect(await http(req(`${base}/slow`))).toEqual({ ok: false, errorCode: 'timeout' });
  });

  it('maps a refused connection to network', async () => {
    const base = await start((_q, res) => res.end('{}'));
    await new Promise<void>((r) => server!.close(() => r()));
    const http = createSafeHttp({ allowHttpHosts: ['127.0.0.1'] });
    expect(await http(req(`${base}/`))).toEqual({ ok: false, errorCode: 'network' });
  });
});
