import { describe, expect, it } from 'vitest';

import { formatVnPhone, maskPhone, normalizeVnPhone } from './phone.js';

describe('normalizeVnPhone', () => {
  it.each([
    ['0912345678', '+84912345678'],
    ['84912345678', '+84912345678'],
    ['+84 912 345 678', '+84912345678'],
    ['(+84)912-345-678', '+84912345678'],
    ['912345678', '+84912345678'],
    ['0325551234', '+84325551234'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeVnPhone(input)).toBe(expected);
  });

  it.each(['', 'abc', '0123456789', '09123', '+1 555 123 4567', '01912345678'])(
    'rejects invalid input %s',
    (input) => {
      expect(normalizeVnPhone(input)).toBeNull();
    },
  );
});

describe('formatVnPhone', () => {
  it('renders the national format with a leading zero', () => {
    expect(formatVnPhone('+84912345678')).toBe('0912345678');
  });

  it('rejects non-Vietnamese numbers', () => {
    expect(() => formatVnPhone('+15551234567')).toThrow(RangeError);
  });
});

describe('maskPhone', () => {
  it('hides the middle digits', () => {
    expect(maskPhone('+84912345678')).toBe('+84912***678');
  });
});
