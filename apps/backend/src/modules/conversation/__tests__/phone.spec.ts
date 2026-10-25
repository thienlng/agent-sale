import { describe, expect, it } from 'vitest';
import { detectVietnamesePhone } from '../domain/phone.js';

describe('detectVietnamesePhone', () => {
  it.each([
    ['0912345678', '0912345678'],
    ['SĐT em là 0912 345 678 nhé', '0912345678'],
    ['gọi 0912.345.678 giúp em', '0912345678'],
    ['zalo: 091-234-5678', '0912345678'],
    ['+84 912 345 678', '0912345678'],
    ['84912345678', '0912345678'],
    ['+84912345678.', '0912345678'],
    ['0912345678 2 cái áo', '0912345678'],
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
    '',
  ])('ignores %j', (text) => {
    expect(detectVietnamesePhone(text)).toBeNull();
  });
});
