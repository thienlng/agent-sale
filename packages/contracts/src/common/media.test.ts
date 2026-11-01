import { describe, expect, it } from 'vitest';

import { isMediaPath, PublicImageUrl } from './media.js';

const WS = '0192f0a0-0000-7000-8000-000000000001';

describe('isMediaPath', () => {
  it('accepts a plain /media/ object path', () => {
    expect(isMediaPath(`/media/products/${WS}/abc.jpg`)).toBe(true);
  });
  it('rejects traversal, empty segments, queries, encodings and other roots', () => {
    for (const bad of [
      `/media/products/${WS}/../x.jpg`,
      `/media//products/x.jpg`,
      `/media/products/${WS}/a.jpg?x=1`,
      `/media/products/${WS}/%2e%2e/a.jpg`,
      '//evil.example/media/a.jpg',
      '/api/v1/x.jpg',
      'media/products/a.jpg',
      '/media/products/a',
    ])
      expect(isMediaPath(bad), bad).toBe(false);
  });
});

describe('PublicImageUrl', () => {
  it('accepts an https link or a stored media path', () => {
    expect(PublicImageUrl.safeParse('https://cdn.example.com/a.jpg').success).toBe(true);
    expect(PublicImageUrl.safeParse(`/media/products/${WS}/abc.jpg`).success).toBe(true);
  });
  it('rejects http, javascript, data and unsafe paths', () => {
    for (const bad of [
      'http://x.com/a.jpg',
      'javascript:alert(1)',
      'data:image/png;base64,AA',
      '/media/../a.jpg',
    ])
      expect(PublicImageUrl.safeParse(bad).success, bad).toBe(false);
  });
});
