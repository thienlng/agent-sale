import { describe, expect, it } from 'vitest';

import { cleanExternalContact, externalPatch } from './external-contact.js';

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
