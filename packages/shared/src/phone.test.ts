import { describe, expect, it } from 'vitest';

import {
  formatVnPhone,
  maskPhone,
  normalizeAnyPhone,
  findVnPhone,
  normalizeEmail,
  normalizeLeadPhone,
  normalizeVnPhone,
} from './phone.js';

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

describe('normalizeAnyPhone', () => {
  it('normalizes Vietnamese mobiles like normalizeVnPhone', () => {
    expect(normalizeAnyPhone('0912 345 678')).toBe('+84912345678');
    expect(normalizeAnyPhone('84912345678')).toBe('+84912345678');
  });
  it('keeps foreign numbers written with a country code', () => {
    expect(normalizeAnyPhone('+1 (555) 123-4567')).toBe('+15551234567');
  });
  it('rejects text and numbers without a usable form', () => {
    expect(normalizeAnyPhone('abc')).toBeNull();
    expect(normalizeAnyPhone('0123456789')).toBeNull();
    expect(normalizeAnyPhone('+12')).toBeNull();
  });
  it('lower-cases emails', () => {
    expect(normalizeEmail('  Lan@Shop.VN ')).toBe('lan@shop.vn');
  });
});

describe('normalizeVnPhone legacy prefixes', () => {
  it.each([
    ['01681234567', '+84381234567'],
    ['0169 123 4567', '+84391234567'],
    ['01201234567', '+84701234567'],
    ['01881234567', '+84581234567'],
  ])('maps %s to %s', (input, expected) => {
    expect(normalizeVnPhone(input)).toBe(expected);
  });
});

describe('normalizeLeadPhone', () => {
  it.each([
    ['0912345679', '+84912345679'],
    ['01681234567', '+84381234567'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeLeadPhone(input)).toBe(expected);
  });

  it.each([
    '0987654321',
    '0123456789',
    '0909090909',
    '0912345678',
    '0000000000',
    '1234567890',
    '+84 987 654 321',
  ])('rejects placeholder %s', (input) => {
    expect(normalizeLeadPhone(input)).toBeNull();
  });
});

describe('findVnPhone', () => {
  it.each([
    ['em sdt 0912 345 679 nhé', '+84912345679'],
    ['gọi +84 38 123 4567 giúp', '+84381234567'],
    ['84381234567', '+84381234567'],
    ['01681234567', '+84381234567'],
    ['gọi 0901.234.568', '+84901234568'],
    ['sdt: 090-123-4568.', '+84901234568'],
    ['0987654321 rồi 0912345679', '+84912345679'],
    ['mua 2 0912345679', '+84912345679'],
    ['2 0901234568', '+84901234568'],
    ['0901 234 568 3 cái', '+84901234568'],
  ])('finds the number in %s', (input, expected) => {
    expect(findVnPhone(input)).toBe(expected);
  });

  it.each(['abc', '', '02838123456', 'mã đơn 123456', 'giá 0987654321', 'số 09123456789012'])(
    'finds nothing in %s',
    (input) => {
      expect(findVnPhone(input)).toBeNull();
    },
  );
});
