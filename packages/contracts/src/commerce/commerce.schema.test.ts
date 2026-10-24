import { describe, expect, it } from 'vitest';

import { ProductDto, UpsertProductRequest } from './commerce.schema.js';

const base = { code: 'OX-1', name: 'Oxford', variants: [{ sku: 'OX-1-42', price: 100000 }] };

describe('product images', () => {
  it('defaults to no images and keeps up to five https URLs', () => {
    expect(UpsertProductRequest.parse(base)).toMatchObject({ imageUrls: [] });
    const urls = Array.from({ length: 5 }, (_, i) => `https://cdn.example.com/${i}.jpg`);
    expect(UpsertProductRequest.parse({ ...base, imageUrls: urls }).imageUrls).toEqual(urls);
  });

  it('rejects a sixth image, a non-https URL and an overlong URL', () => {
    const six = Array.from({ length: 6 }, (_, i) => `https://cdn.example.com/${i}.jpg`);
    expect(UpsertProductRequest.safeParse({ ...base, imageUrls: six }).success).toBe(false);
    for (const bad of ['http://cdn.example.com/a.jpg', 'javascript:alert(1)', 'not a url'])
      expect(UpsertProductRequest.safeParse({ ...base, imageUrls: [bad] }).success).toBe(false);
    const long = `https://cdn.example.com/${'a'.repeat(2000)}.jpg`;
    expect(UpsertProductRequest.safeParse({ ...base, imageUrls: [long] }).success).toBe(false);
  });

  it('reads a product row written before the column existed as having no images', () => {
    const dto = ProductDto.shape.imageUrls.parse(undefined);
    expect(dto).toEqual([]);
  });
});
