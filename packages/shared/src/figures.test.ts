import { describe, expect, it } from 'vitest';

import { RISKY_FIGURE_MIN, ungroundedFigures } from './figures.js';

describe('ungroundedFigures', () => {
  it('compares figures by the amount they denote', () => {
    expect(ungroundedFigures('Giá 350k', ['350.000đ'])).toEqual([]);
    expect(ungroundedFigures('Giá 42k', ['size 42'])).toEqual(['42k']);
  });

  it('lets the customer vouch only for non-money figures', () => {
    expect(ungroundedFigures('Size 42 ạ', [], ['size 42'])).toEqual([]);
    expect(ungroundedFigures('Dạ 200k ạ', [], ['200k được không'])).toEqual(['200k']);
  });

  describe('risky mode', () => {
    it('checks money and bare numbers from RISKY_FIGURE_MIN up only', () => {
      expect(RISKY_FIGURE_MIN).toBe(1_000);
      expect(ungroundedFigures('Giao 3 ngày, size 42', [], [], { risky: true })).toEqual([]);
      expect(ungroundedFigures('Giao 3 ngày', [])).toEqual(['3']);
      expect(ungroundedFigures('Chỉ 5k thôi', [], [], { risky: true })).toEqual(['5k']);
      expect(ungroundedFigures('Mã 123456', [], [], { risky: true })).toEqual(['123456']);
    });

    it('treats an invented phone number as risky, the same however it is spaced', () => {
      expect(ungroundedFigures('Gọi 0901 234 567', ['0901234567'], [], { risky: true })).toEqual(
        [],
      );
      expect(ungroundedFigures('Gọi 0909 999 999', [], [], { risky: true })).toHaveLength(1);
    });
  });
});
