import { describe, expect, it } from 'vitest';

import { normalizeTags } from './booking-support.js';

describe('normalizeTags', () => {
  it('trims, drops empties and duplicates, keeping the first occurrence', () => {
    expect(normalizeTags([' VIP ', '', 'Khách quen', 'VIP'])).toEqual(['VIP', 'Khách quen']);
  });

  it('stores an NFD "Đã cọc" as the NFC tag, so it matches the suggestion and the filter', () => {
    const nfc = 'Đã cọc'.normalize('NFC');
    const nfd = nfc.normalize('NFD');
    expect(normalizeTags([nfd])).toEqual([nfc]);
    expect(normalizeTags([nfc, nfd])).toEqual([nfc]);
  });
});
