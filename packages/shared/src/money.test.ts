import { describe, expect, it } from 'vitest';

import { formatCredits, formatVnd, vndToMilliCredits } from './money.js';

describe('formatVnd', () => {
  it('groups thousands with dots and appends the đ sign', () => {
    expect(formatVnd(125_000)).toBe('125.000đ');
    expect(formatVnd(1_624_000)).toBe('1.624.000đ');
    expect(formatVnd(0)).toBe('0đ');
  });

  it('keeps the sign for negative amounts', () => {
    expect(formatVnd(-5_000)).toBe('-5.000đ');
  });

  it('rejects non-integer amounts', () => {
    expect(() => formatVnd(10.5)).toThrow(TypeError);
  });
});

describe('credits', () => {
  it('maps the reference AI price table to credits', () => {
    // 60 / 110 / 150 / 195 VND per reply → 0.06 / 0.11 / 0.15 / 0.195 credits
    expect(formatCredits(vndToMilliCredits(60))).toBe('0.06');
    expect(formatCredits(vndToMilliCredits(110))).toBe('0.11');
    expect(formatCredits(vndToMilliCredits(150))).toBe('0.15');
    expect(formatCredits(vndToMilliCredits(195))).toBe('0.195');
  });

  it('formats whole credits without trailing zeros', () => {
    expect(formatCredits(1_000)).toBe('1');
    expect(formatCredits(1_500)).toBe('1.5');
  });

  it('rejects negative or fractional VND', () => {
    expect(() => vndToMilliCredits(-1)).toThrow(RangeError);
    expect(() => vndToMilliCredits(1.5)).toThrow(RangeError);
  });
});
