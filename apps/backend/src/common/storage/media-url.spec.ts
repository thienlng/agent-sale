import { describe, expect, it } from 'vitest';

import { absoluteMediaUrl, mediaPath, toMediaPath } from './media-url.js';

const WS = '0192f0a0-0000-7000-8000-000000000001';
const F = '0192f0a0-0000-7000-8000-0000000000aa';
const KEY = `products/${WS}/${F}.jpg`;

describe('mediaPath', () => {
  it('returns the /media/ path of a stored URL whatever its host', () => {
    expect(mediaPath(`https://old-tunnel.trycloudflare.com/media/${KEY}`)).toBe(`/media/${KEY}`);
    expect(mediaPath(`https://new.example.com/media/${KEY}`)).toBe(`/media/${KEY}`);
    expect(mediaPath(`/media/${KEY}`)).toBe(`/media/${KEY}`);
  });
  it('covers bot library and website chat uploads too', () => {
    expect(mediaPath(`https://h.test/media/workspaces/${WS}/bots/${F}/${F}.png`)).toBe(
      `/media/workspaces/${WS}/bots/${F}/${F}.png`,
    );
  });
  it('is null for links that are not Rapiz media', () => {
    expect(mediaPath('https://img.example.com/a.jpg')).toBeNull();
    expect(mediaPath('https://shop.example.com/media/catalog/a.jpg')).toBeNull();
    expect(mediaPath(`https://h.test/media/${KEY}?x=1`)).toBeNull();
    expect(mediaPath(`https://h.test/media/products/${WS}/../x.jpg`)).toBeNull();
    expect(mediaPath('javascript:alert(1)')).toBeNull();
    expect(mediaPath('https://cdn.shop.vn/media/products/villa-1.jpg')).toBeNull();
    expect(mediaPath('not a url')).toBeNull();
  });
});

describe('toMediaPath', () => {
  it('keeps anything that is not Rapiz media unchanged', () => {
    expect(toMediaPath('https://img.example.com/a.jpg')).toBe('https://img.example.com/a.jpg');
    expect(toMediaPath(`https://x.trycloudflare.com/media/${KEY}`)).toBe(`/media/${KEY}`);
    const lookAlike = 'https://cdn.shop.vn/media/products/villa-1.jpg';
    expect(toMediaPath(lookAlike)).toBe(lookAlike);
    expect(absoluteMediaUrl(lookAlike, 'https://now.test/media')).toBe(lookAlike);
  });
});

describe('absoluteMediaUrl', () => {
  it('rebuilds the URL on the current public base', () => {
    const base = 'https://now.trycloudflare.com/media';
    expect(absoluteMediaUrl(`/media/${KEY}`, base)).toBe(
      `https://now.trycloudflare.com/media/${KEY}`,
    );
    expect(absoluteMediaUrl(`https://old.trycloudflare.com/media/${KEY}`, `${base}/`)).toBe(
      `https://now.trycloudflare.com/media/${KEY}`,
    );
  });
  it('keeps external links and leaves media unchanged without a base', () => {
    expect(absoluteMediaUrl('https://img.example.com/a.jpg', 'https://now.test/media')).toBe(
      'https://img.example.com/a.jpg',
    );
    expect(absoluteMediaUrl(`/media/${KEY}`, undefined)).toBe(`/media/${KEY}`);
  });
});
