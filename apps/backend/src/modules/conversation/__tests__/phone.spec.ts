import { describe, expect, it } from 'vitest';
import { detectVietnamesePhone, normalizeVietnamesePhone } from '../domain/phone.js';

describe('detectVietnamesePhone', () => {
  it.each([
    ['0912345678', '0912345678'],
    ['SĐT em là 0912 345 678 nhé', '0912345678'],
    ['gọi 0912.345.678 giúp em', '0912345678'],
    ['zalo: 091-234-5678', '0912345678'],
    ['+84 912 345 678', '0912345678'],
    ['84912345678', '0912345678'],
    ['+84912345678.', '0912345678'],
    ['em là Lan, sdt: 0912345678', '0912345678'],
    ['0912 345 678.', '0912345678'],
  ])('finds %s', (text, expected) => {
    expect(detectVietnamesePhone(text)).toBe(expected);
  });

  it('keeps the last number when a message holds several', () => {
    expect(detectVietnamesePhone('cũ 0912345678, mới 0388 111 222')).toBe('0388111222');
  });

  it.each([
    'chị ơi son này còn không',
    '12345678',
    '0212345678',
    '09123456789012',
    'mã đơn 20261025123456789',
    '+1 415 555 0132',
    'Ship ngày 03-12-2024 15h',
    '0912 345 678 000',
    '0912345678 2 cái áo',
    'Giá 1.250.000đ',
    'Tổng 2.500.000.000đ',
    'DH0912345678',
    '0912-345 678',
    'mã vận đơn 1.0912.345.678',
    '',
  ])('ignores %j', (text) => {
    expect(detectVietnamesePhone(text)).toBeNull();
  });
});

describe('normalizeVietnamesePhone', () => {
  it.each([
    ['0912 345 678', '0912345678'],
    ['+84 912 345 678', '0912345678'],
    ['84912345678', '0912345678'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeVietnamesePhone(input)).toBe(expected);
  });
  it.each(['', 'abc', '0912 345 678 và 0388111222', '12345', 'sdt 0912345678'])(
    'rejects %j',
    (v) => {
      expect(normalizeVietnamesePhone(v)).toBeNull();
    },
  );
});
