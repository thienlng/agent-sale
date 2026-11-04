import { describe, expect, it } from 'vitest';

import { accountNameFor, pickAccountForNewBusiness } from './account.js';

describe('pickAccountForNewBusiness (ADR-012 §3)', () => {
  it('uses the requested account only when the user owns it', () => {
    expect(pickAccountForNewBusiness({ requested: 'a1', owned: ['a1', 'a2'] })).toBe('a1');
    expect(() => pickAccountForNewBusiness({ requested: 'a9', owned: ['a1'] })).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('falls back to the only owned account, or none (create one)', () => {
    expect(pickAccountForNewBusiness({ requested: undefined, owned: ['a1'] })).toBe('a1');
    expect(pickAccountForNewBusiness({ requested: undefined, owned: [] })).toBeNull();
  });

  it('asks the user to choose when they own several accounts', () => {
    expect(() => pickAccountForNewBusiness({ requested: undefined, owned: ['a1', 'a2'] })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });
});

describe('accountNameFor', () => {
  it('names a new account after its owner, not after the first business', () => {
    const owner = { name: ' Nguyễn Thị Lan ', email: 'lan@shop.vn' };
    expect(accountNameFor({ owner, businessName: 'Shop thời trang Lan' })).toBe('Nguyễn Thị Lan');
  });

  it('falls back to the email local part, then to the business name', () => {
    expect(accountNameFor({ owner: { name: '', email: 'lan@shop.vn' }, businessName: 'X' })).toBe(
      'lan',
    );
    expect(accountNameFor({ businessName: ' Rapiz HQ ' })).toBe('Rapiz HQ');
  });
});
