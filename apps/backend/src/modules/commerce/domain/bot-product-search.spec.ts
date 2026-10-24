import { describe, expect, it } from 'vitest';

import { botProductSearches } from './bot-product-search.js';

describe('botProductSearches', () => {
  it('drops picture-request filler and keeps the product words', () => {
    const { words } = botProductSearches('cho xem ảnh đôi giày Oxford nhé shop');
    expect(words).toEqual(['doi', 'giay', 'oxford']);
  });

  it('still reaches a product named after another question in a merged turn', () => {
    const { searches } = botProductSearches(
      'phí ship bao nhiêu vậy\ncho xem ảnh giày sneaker trắng',
    );
    expect(searches).toContain('sneaker');
    expect(searches.length).toBeLessThanOrEqual(8);
  });

  it('returns nothing for an empty message', () => {
    expect(botProductSearches('   ').searches).toEqual([]);
  });
});
