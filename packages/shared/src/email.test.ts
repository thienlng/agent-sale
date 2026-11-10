import { describe, expect, it } from 'vitest';
import { findEmail, maskEmail, normalizeLeadEmail } from './email.js';

describe('findEmail', () => {
  it.each([
    ['email em là Lan.Nguyen@Shop.vn nhé', 'lan.nguyen@shop.vn'],
    ['gửi vào a_b+demo@mail.co.uk.', 'a_b+demo@mail.co.uk'],
    ['(lan@rapiz.vn)', 'lan@rapiz.vn'],
    ['first x@example.com then real@shop.vn', 'real@shop.vn'],
  ])('finds the address in %j', (text, email) => {
    expect(findEmail(text)).toBe(email);
  });

  it.each([
    'không có email',
    'giá 400k @ cửa hàng',
    'lan@localhost',
    'a..b@shop.vn',
    'x@example.com',
  ])('finds nothing usable in %j', (text) => {
    expect(findEmail(text)).toBeNull();
  });
});

describe('normalizeLeadEmail', () => {
  it('lower-cases and trims, and rejects over-long addresses', () => {
    expect(normalizeLeadEmail('  Lan@Shop.VN ')).toBe('lan@shop.vn');
    expect(normalizeLeadEmail(`${'a'.repeat(65)}@shop.vn`)).toBeNull();
  });
});

describe('maskEmail', () => {
  it('keeps the first two characters and the domain', () => {
    expect(maskEmail('lan.nguyen@shop.vn')).toBe('la***@shop.vn');
  });
});
