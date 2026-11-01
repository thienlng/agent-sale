import { describe, expect, it } from 'vitest';

import { catalogTerms } from '../domain/bot-catalog-query.js';

describe('catalogTerms', () => {
  it('folds, strips punctuation and splits into terms', () => {
    expect(catalogTerms('Ơ? Thú gỗ, xếp thăng bằng!!')).toEqual([
      'thu',
      'go',
      'xep',
      'thang',
      'bang',
    ]);
  });

  it('removes duplicates and single letters', () => {
    expect(catalogTerms('gỗ GO a go b xếp')).toEqual(['go', 'xep']);
  });

  it('keeps at most 8 terms', () => {
    expect(catalogTerms('aa bb cc dd ee ff gg hh ii jj')).toHaveLength(8);
  });

  it('returns nothing for an empty or punctuation-only query', () => {
    expect(catalogTerms(' ?! ')).toEqual([]);
  });
});
