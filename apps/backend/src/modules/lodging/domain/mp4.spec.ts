import { describe, expect, it } from 'vitest';

import { isMp4 } from './mp4.js';

const box = (brand: string) =>
  new Uint8Array([0, 0, 0, 0x18, ...Buffer.from('ftyp'), ...Buffer.from(brand), 0, 0, 2, 0]);

describe('isMp4', () => {
  it('accepts an ISO-BMFF ftyp box of an MP4 brand', () => {
    for (const brand of ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash'])
      expect(isMp4(box(brand)), brand).toBe(true);
  });
  it('refuses other brands, other boxes and short input', () => {
    expect(isMp4(box('qt  '))).toBe(false);
    expect(isMp4(new Uint8Array([0, 0, 0, 0x18, ...Buffer.from('moovisom')]))).toBe(false);
    expect(isMp4(Buffer.from('hello world'))).toBe(false);
    expect(isMp4(new Uint8Array(0))).toBe(false);
  });
});
