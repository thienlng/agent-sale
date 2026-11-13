import { describe, expect, it } from 'vitest';

import { internationalPhone } from './bot-hold.service.js';

describe('internationalPhone (VL3-3)', () => {
  it('accepts a foreign number in E.164, with spaces or 00', () => {
    expect(internationalPhone('+61 412 345 678')).toBe('+61412345678');
    expect(internationalPhone('0065-9123-4567')).toBe('+6591234567');
  });
  it('leaves Vietnamese and malformed numbers alone', () => {
    expect(internationalPhone('+84 912 345 678')).toBeNull();
    expect(internationalPhone('0912345678')).toBeNull();
    expect(internationalPhone('+61 41')).toBeNull();
  });
});
