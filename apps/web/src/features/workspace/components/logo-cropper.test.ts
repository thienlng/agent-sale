import { describe, expect, it } from 'vitest';

import { clampCrop, coverScale, cropRect } from './logo-cropper';

describe('logo cropper geometry', () => {
  it('covers the frame with the short side at zoom 1', () => {
    expect(coverScale(1600, 1472, 280)).toBeCloseTo(280 / 1472);
    expect(coverScale(400, 800, 280)).toBeCloseTo(280 / 400);
  });

  it('never lets the frame show past the image edge', () => {
    // 2:1 image, frame 100: at zoom 1 it is 200 × 100 on screen.
    expect(clampCrop({ zoom: 1, x: 50, y: 20 }, 200, 100, 100)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(clampCrop({ zoom: 1, x: -500, y: -5 }, 200, 100, 100)).toEqual({
      zoom: 1,
      x: -100,
      y: 0,
    });
    expect(clampCrop({ zoom: 9, x: 0, y: 0 }, 200, 100, 100).zoom).toBe(4);
    expect(clampCrop({ zoom: 0.2, x: 0, y: 0 }, 200, 100, 100).zoom).toBe(1);
  });

  it('maps the frame back to a square source rectangle', () => {
    // 1000 × 500 image, frame 100 → scale 0.2; zoom 2 → 0.4.
    expect(cropRect({ zoom: 2, x: -40, y: -20 }, 1000, 500, 100)).toEqual({
      sx: 100,
      sy: 50,
      side: 250,
    });
  });
});
