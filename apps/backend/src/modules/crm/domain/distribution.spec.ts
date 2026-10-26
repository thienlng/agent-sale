import { describe, expect, it } from 'vitest';

import { pickCandidate } from './distribution.js';

describe('pickCandidate', () => {
  it('hands out customers in proportion to the weights, cycle after cycle', () => {
    const list = [
      { userId: 'a', weight: 2 },
      { userId: 'b', weight: 1 },
    ];
    const picks = Array.from({ length: 6 }, (_, i) => pickCandidate(list, i));
    expect(picks).toEqual(['a', 'a', 'b', 'a', 'a', 'b']);
  });

  it('nobody to pick from gives null', () => {
    expect(pickCandidate([], 3)).toBeNull();
  });
});
