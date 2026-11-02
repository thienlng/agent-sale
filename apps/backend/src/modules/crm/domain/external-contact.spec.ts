import { describe, expect, it } from 'vitest';

import {
  cleanExternalContact,
  externalPatch,
  isPhoneName,
  lockedFields,
  normalizeExternalId,
  ownedPatch,
  rejectedFields,
} from './external-contact.js';

const raw = {
  externalId: '101',
  name: '  Nguyễn Văn A  ',
  phone: '0912 345 678',
  email: 'A@Example.vn',
  address: ' 12 Lê Lợi ',
  birthday: '1990-05-04T00:00:00',
  gender: 'male' as const,
};

describe('cleanExternalContact', () => {
  it('trims text, keeps a usable phone and takes the date part of a birthday', () => {
    expect(cleanExternalContact(raw)).toEqual({
      name: 'Nguyễn Văn A',
      phone: '0912 345 678',
      email: 'A@Example.vn',
      address: '12 Lê Lợi',
      birthday: '1990-05-04',
      gender: 'male',
    });
  });

  it('drops an unusable phone, a malformed email and a bad birthday instead of failing', () => {
    expect(
      cleanExternalContact({
        ...raw,
        phone: '0123',
        email: 'not-an-email',
        birthday: '04/05/1990',
        address: '   ',
      }),
    ).toMatchObject({ phone: null, email: null, birthday: null, address: null });
  });

  it('accepts a space-separated date-time birthday', () => {
    expect(cleanExternalContact({ ...raw, birthday: '1990-05-04 00:00:00' })?.birthday).toBe(
      '1990-05-04',
    );
  });

  it('caps long text to what the CRM form accepts', () => {
    const c = cleanExternalContact({ ...raw, name: 'x'.repeat(200), address: 'y'.repeat(400) });
    expect(c?.name).toHaveLength(120);
    expect(c?.address).toHaveLength(300);
  });

  it('is null when nothing identifies the customer', () => {
    expect(cleanExternalContact({ ...raw, name: ' ', phone: 'abc', email: null })).toBeNull();
    expect(cleanExternalContact({ ...raw, name: '', phone: null, email: 'x@y.vn' })).not.toBeNull();
  });
});

describe('externalPatch', () => {
  const clean = { ...cleanExternalContact(raw)!, email: null, address: null };

  it('overwrites every PMS-owned field of a linked customer, nulls included', () => {
    expect(externalPatch(clean, 'linked')).toEqual({
      name: 'Nguyễn Văn A',
      phone: '0912 345 678',
      email: null,
      address: null,
      birthday: '1990-05-04',
      gender: 'male',
    });
  });

  it('only fills what the PMS knows when adopting a customer matched by phone', () => {
    expect(externalPatch(clean, 'adopt')).toEqual({
      name: 'Nguyễn Văn A',
      phone: '0912 345 678',
      birthday: '1990-05-04',
      gender: 'male',
    });
  });
});

describe('rejectedFields', () => {
  it('lists fields the PMS sent but the CRM could not use, not the empty ones', () => {
    const input = { ...raw, phone: '0123', birthday: '04/05/1990', email: '  ', address: null };
    expect(rejectedFields(input, cleanExternalContact(input)!).sort()).toEqual([
      'birthday',
      'phone',
    ]);
  });

  it('keeps the stored value of a rejected field when a linked customer is overwritten', () => {
    const input = { ...raw, phone: '0123', email: null };
    const clean = cleanExternalContact(input)!;
    const patch = externalPatch(clean, 'linked', rejectedFields(input, clean));
    expect(patch).not.toHaveProperty('phone');
    expect(patch).toMatchObject({ email: null, name: 'Nguyễn Văn A' });
  });
});

describe('normalizeExternalId', () => {
  it('trims and accepts up to 64 characters', () => {
    expect(normalizeExternalId(' 101 ')).toBe('101');
    expect(normalizeExternalId('x'.repeat(64))).toHaveLength(64);
  });

  it('rejects empty and too long ids', () => {
    expect(normalizeExternalId('  ')).toBeNull();
    expect(normalizeExternalId('x'.repeat(65))).toBeNull();
  });
});

describe('isPhoneName', () => {
  it('is true only for a name that is one of the given numbers', () => {
    expect(isPhoneName('0912 345 678', ['+84912345678'])).toBe(true);
    expect(isPhoneName('+84912345678', [null, '+84912345678'])).toBe(true);
    expect(isPhoneName('0912 345 679', ['+84912345678'])).toBe(false);
    expect(isPhoneName('Nguyễn Văn A', ['+84912345678'])).toBe(false);
    expect(isPhoneName(null, ['+84912345678'])).toBe(false);
    expect(isPhoneName('0912345678', [null])).toBe(false);
  });
});

describe('Rapiz HQ ownership (ADR-021 §3)', () => {
  const patch = { name: 'Rapiz name', phone: '0912345678', email: 'a@b.vn', address: 'x' };

  it('owns only phone and email, and fills the name only when the customer has none', () => {
    expect(ownedPatch('rapiz', patch, true)).toEqual({ phone: '0912345678', email: 'a@b.vn' });
    expect(ownedPatch('rapiz', patch, false)).toEqual({
      name: 'Rapiz name',
      phone: '0912345678',
      email: 'a@b.vn',
    });
  });

  it('leaves a PMS patch whole', () => {
    expect(ownedPatch('kiotviet', patch, true)).toEqual(patch);
  });

  it('locks phone and email of a Rapiz-linked customer only', () => {
    expect(lockedFields('rapiz')).toEqual(['phone', 'email']);
    expect(lockedFields('kiotviet')).toEqual([]);
    expect(lockedFields(null)).toEqual([]);
    expect(lockedFields('unknown')).toEqual([]);
  });
});
