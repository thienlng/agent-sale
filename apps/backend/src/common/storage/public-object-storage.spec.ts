import { describe, expect, it } from 'vitest';

import { S3PublicObjectStorage } from './public-object-storage.js';

const WS = '0192f0a0-0000-7000-8000-000000000001';
const configured = (publicUrl = 'https://now.trycloudflare.com/media') =>
  new S3PublicObjectStorage({
    endpoint: 'http://127.0.0.1:9000',
    bucket: 'b',
    publicUrl,
    accessKey: 'k',
    secretKey: 's',
  });

describe('S3PublicObjectStorage.isPublicUrlUnder', () => {
  const prefix = `products/${WS}/`;
  it('accepts the relative path and the stored URL on any former host', () => {
    const storage = configured();
    expect(storage.isPublicUrlUnder(`/media/products/${WS}/a.jpg`, prefix)).toBe(true);
    expect(
      storage.isPublicUrlUnder(`https://old.trycloudflare.com/media/products/${WS}/a.jpg`, prefix),
    ).toBe(true);
    expect(
      storage.isPublicUrlUnder(`https://now.trycloudflare.com/media/products/${WS}/a.jpg`, prefix),
    ).toBe(true);
  });
  it('rejects other prefixes, external links and unconfigured storage', () => {
    const storage = configured();
    expect(storage.isPublicUrlUnder(`/media/products/other/a.jpg`, prefix)).toBe(false);
    expect(storage.isPublicUrlUnder('https://img.example.com/a.jpg', prefix)).toBe(false);
    expect(
      new S3PublicObjectStorage({ publicUrl: 'https://x.test/media' }).isPublicUrlUnder(
        `/media/products/${WS}/a.jpg`,
        prefix,
      ),
    ).toBe(false);
  });
  it('keeps the exact-base rule for a public URL outside /media (e.g. a CDN bucket)', () => {
    const storage = configured('https://cdn.example.com/bucket');
    expect(
      storage.isPublicUrlUnder(`https://cdn.example.com/bucket/products/${WS}/a.jpg`, prefix),
    ).toBe(true);
    expect(
      storage.isPublicUrlUnder(`https://other.example.com/bucket/products/${WS}/a.jpg`, prefix),
    ).toBe(false);
  });
});
