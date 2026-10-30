import { describe, expect, it } from 'vitest';

import { downloadImage, IMPORT_MAX_BYTES } from '../infrastructure/image-import/download-image.js';

const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(8, 1)]);
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
const reason = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: Error) => e.message,
  );

describe('downloadImage', () => {
  it('returns verified bytes', async () => {
    const img = await downloadImage('https://x.test/a', () => Promise.resolve(new Response(PNG)));
    expect(img.mime).toBe('image/png');
  });

  it('rejects a declared content-length over 10 MiB', async () => {
    const res = new Response(PNG, { headers: { 'content-length': String(IMPORT_MAX_BYTES + 1) } });
    expect(await reason(downloadImage('https://x.test/a', () => Promise.resolve(res)))).toBe(
      'too_large',
    );
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
      await reason(downloadImage('https://x.test/a', () => Promise.resolve(new Response(body)))),
    ).toBe('too_large');
    expect(cancelled).toBe(true);
  });

  it('allows 3 redirects but not 4', async () => {
    let n = 0;
    const chain = (limit: number) => () =>
      Promise.resolve(n++ < limit ? redirect(`/r${n}`) : new Response(PNG));
    expect((await downloadImage('https://x.test/a', chain(3))).mime).toBe('image/png');
    n = 0;
    expect(await reason(downloadImage('https://x.test/a', chain(4)))).toBe('too_many_redirects');
  });

  it('rejects a redirect to a non-http(s) scheme', async () => {
    expect(
      await reason(
        downloadImage('https://x.test/a', () => Promise.resolve(redirect('file:///etc/passwd'))),
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
      expect(await reason(downloadImage('https://x.test/a', hang as typeof fetch))).toBe('timeout');
    } finally {
      AbortSignal.timeout = ac;
    }
  });
});
