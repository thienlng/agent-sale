import { describe, expect, it } from 'vitest';

import {
  downloadImage,
  IMPORT_MAX_BYTES,
  type DownloadOptions,
} from '../infrastructure/image-import/download-image.js';

const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(8, 1)]);
const PUBLIC: DownloadOptions = { resolve: () => Promise.resolve(['93.184.216.34']) };
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
const reason = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: Error) => e.message,
  );

describe('downloadImage', () => {
  it('returns verified bytes', async () => {
    const img = await downloadImage(
      'https://x.test/a',
      () => Promise.resolve(new Response(PNG)),
      PUBLIC,
    );
    expect(img.mime).toBe('image/png');
  });

  it('rejects a declared content-length over 10 MiB', async () => {
    const res = new Response(PNG, { headers: { 'content-length': String(IMPORT_MAX_BYTES + 1) } });
    expect(
      await reason(downloadImage('https://x.test/a', () => Promise.resolve(res), PUBLIC)),
    ).toBe('too_large');
  });

  it('cancels a streamed body that grows over 10 MiB', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull: (c) => c.enqueue(new Uint8Array(1_048_576)),
      cancel: () => {
        cancelled = true;
      },
    });
    expect(
      await reason(
        downloadImage('https://x.test/a', () => Promise.resolve(new Response(body)), PUBLIC),
      ),
    ).toBe('too_large');
    expect(cancelled).toBe(true);
  });

  it('allows 3 redirects but not 4', async () => {
    let n = 0;
    const chain = (limit: number) => () =>
      Promise.resolve(n++ < limit ? redirect(`/r${n}`) : new Response(PNG));
    expect((await downloadImage('https://x.test/a', chain(3), PUBLIC)).mime).toBe('image/png');
    n = 0;
    expect(await reason(downloadImage('https://x.test/a', chain(4), PUBLIC))).toBe(
      'too_many_redirects',
    );
  });

  it('rejects a redirect to a non-http(s) scheme', async () => {
    expect(
      await reason(
        downloadImage(
          'https://x.test/a',
          () => Promise.resolve(redirect('file:///etc/passwd')),
          PUBLIC,
        ),
      ),
    ).toBe('unsupported_scheme');
  });

  it('reports a timeout', async () => {
    const hang = (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        if (init?.signal?.aborted) reject(new Error('aborted'));
      });
    const ac = AbortSignal.timeout;
    AbortSignal.timeout = () => AbortSignal.abort();
    try {
      expect(await reason(downloadImage('https://x.test/a', hang as typeof fetch, PUBLIC))).toBe(
        'timeout',
      );
    } finally {
      AbortSignal.timeout = ac;
    }
  });

  describe('address guard', () => {
    const calls: string[] = [];
    const ok = (u: unknown) => {
      calls.push(String(u as string));
      return Promise.resolve(new Response(PNG));
    };
    const to = (...addresses: string[]): DownloadOptions => ({
      resolve: () => Promise.resolve(addresses),
    });

    it('blocks a literal loopback host before any request', async () => {
      calls.length = 0;
      expect(await reason(downloadImage('http://127.0.0.1/a', ok, to('93.184.216.34')))).toBe(
        'blocked_address',
      );
      expect(calls).toHaveLength(0);
    });

    it.each([
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '0.0.0.0',
      '169.254.1.1',
      '::1',
      'fe80::1',
      'fd00::1',
      '::ffff:10.0.0.1',
    ])('blocks a host resolving to %s', async (addr) => {
      expect(await reason(downloadImage('https://x.test/a', ok, to(addr)))).toBe('blocked_address');
    });

    it('blocks literal IPv6 loopback hosts', async () => {
      expect(await reason(downloadImage('http://[::1]/a', ok, to('93.184.216.34')))).toBe(
        'blocked_address',
      );
    });

    it('blocks when any resolved address is private', async () => {
      expect(
        await reason(downloadImage('https://x.test/a', ok, to('93.184.216.34', '10.0.0.5'))),
      ).toBe('blocked_address');
    });

    it('blocks a redirect to the metadata address', async () => {
      calls.length = 0;
      const fetchImpl = (u: unknown) => {
        calls.push(String(u as string));
        return Promise.resolve(redirect('http://169.254.169.254/latest/meta-data'));
      };
      expect(
        await reason(downloadImage('https://x.test/a', fetchImpl as typeof fetch, PUBLIC)),
      ).toBe('blocked_address');
      expect(calls).toEqual(['https://x.test/a']);
    });

    it('allows a public address and honours allowPrivateHosts', async () => {
      expect((await downloadImage('https://x.test/a', ok, to('93.184.216.34'))).mime).toBe(
        'image/png',
      );
      expect(
        (await downloadImage('http://127.0.0.1/a', ok, { allowPrivateHosts: true })).mime,
      ).toBe('image/png');
    });
  });
});
