import { describe, expect, it } from 'vitest';

import { parseRetailer } from './retailer.js';

describe('parseRetailer', () => {
  it.each([
    ['abc', 'abc'],
    ['  ABC-shop ', 'abc-shop'],
    ['abc.kiotviet.vn', 'abc'],
    ['https://abc.kiotviet.vn/man', 'abc'],
    ['http://Abc.KiotViet.vn/man/#/DashBoard', 'abc'],
    ['abc.kiotviet.vn/', 'abc'],
    ['shop2024', 'shop2024'],
  ])('reads %j as %j', (input, expected) => expect(parseRetailer(input)).toBe(expected));

  it.each([
    [''],
    ['a'],
    ['x'.repeat(65)],
    ['abc shop'],
    ['abc_shop'],
    ['abc.example.com'],
    ['https://kiotviet.vn'],
    ['cửahàng'],
  ])('rejects %j', (input) => expect(parseRetailer(input)).toBeNull());
});
