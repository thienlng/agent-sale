import { describe, expect, it } from 'vitest';
import { joinedImages } from '../application/reply-pipeline.js';

describe('joinedImages', () => {
  it('keeps each picture once and stays within the 30-picture contract', () => {
    const images = Array.from({ length: 40 }, (_, i) => ({
      url: `https://media.example/products/ws/${i}.jpg`,
      label: `p${i}`,
    }));
    const joined = joinedImages([images[0]!, ...images]);
    expect(joined).toHaveLength(30);
    expect(joined[0]).toEqual({ url: images[0]!.url, label: 'p0' });
    expect(new Set(joined.map((i) => i.url)).size).toBe(30);
  });
});
