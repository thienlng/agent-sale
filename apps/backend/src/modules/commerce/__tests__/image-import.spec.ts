import { describe, expect, it } from 'vitest';

import { allImageUrls, classifyImageUrls, rewriteImageUrls } from '../domain/image-import.js';

const own = (u: string) => u.startsWith('https://m.test/products/w/');
const product = {
  imageUrls: ['https://m.test/products/w/a.jpg', 'https://cdn.x/b.jpg'],
  accommodation: {
    rooms: 2,
    gallery: [
      { url: 'https://cdn.x/c.jpg', caption: 'Pool' },
      { url: 'https://m.test/products/w/d.png', caption: 'Bed' },
    ],
  },
};

describe('image import (pure)', () => {
  it('lists urls in order and classifies stored vs external', () => {
    expect(allImageUrls(product)).toHaveLength(4);
    expect(classifyImageUrls(product, own)).toEqual({
      stored: 2,
      external: ['https://cdn.x/b.jpg', 'https://cdn.x/c.jpg'],
    });
    expect(classifyImageUrls({ imageUrls: [], accommodation: null }, own)).toEqual({
      stored: 0,
      external: [],
    });
  });

  it('rewrites in place keeping order and gallery fields; null when unchanged', () => {
    const out = rewriteImageUrls(
      product,
      new Map([
        ['https://cdn.x/b.jpg', 'https://m.test/products/w/b.jpg'],
        ['https://cdn.x/c.jpg', 'https://m.test/products/w/c.jpg'],
      ]),
    );
    expect(out?.imageUrls).toEqual([
      'https://m.test/products/w/a.jpg',
      'https://m.test/products/w/b.jpg',
    ]);
    expect(out?.accommodation).toEqual({
      rooms: 2,
      gallery: [
        { url: 'https://m.test/products/w/c.jpg', caption: 'Pool' },
        { url: 'https://m.test/products/w/d.png', caption: 'Bed' },
      ],
    });
    expect(rewriteImageUrls(product, new Map())).toBeNull();
  });
});
