import { describe, expect, it } from 'vitest';

import {
  contactOfKvCustomer,
  KV_CUSTOMER_GENDER,
  type KvCustomer,
  kiotVietCustomerBody,
  kiotVietPhone,
  matchesPhone,
} from './kiotviet-customer.js';

const kv = (over: Partial<KvCustomer> = {}): KvCustomer => ({
  id: 9001,
  code: 'KH000001',
  name: 'Trần Thị B',
  contactNumber: '0912000001',
  email: 'b@shop.vn',
  address: '1 Hàng Bài',
  wardName: null,
  locationName: null,
  birthDate: '1990-05-01T00:00:00',
  gender: KV_CUSTOMER_GENDER.female,
  ...over,
});

describe('contactOfKvCustomer', () => {
  it('maps a KiotViet customer to the CRM input, the id as text', () => {
    expect(contactOfKvCustomer(kv())).toEqual({
      externalId: '9001',
      name: 'Trần Thị B',
      phone: '0912000001',
      email: 'b@shop.vn',
      address: '1 Hàng Bài',
      birthday: '1990-05-01T00:00:00',
      gender: 'female',
    });
  });

  it('maps the gender flag (true male, false female, missing unknown)', () => {
    expect(contactOfKvCustomer(kv({ gender: true })).gender).toBe('male');
    expect(contactOfKvCustomer(kv({ gender: false })).gender).toBe('female');
    expect(contactOfKvCustomer(kv({ gender: null })).gender).toBeNull();
  });

  it('keeps the first of several numbers and joins the address parts', () => {
    const c = contactOfKvCustomer(
      kv({
        contactNumber: ' 0912000001 / 0987000002',
        address: '1 Hàng Bài',
        wardName: 'Phường Tràng Tiền',
        locationName: 'Hà Nội - Quận Hoàn Kiếm',
      }),
    );
    expect(c.phone).toBe('0912000001');
    expect(c.address).toBe('1 Hàng Bài, Phường Tràng Tiền, Hà Nội - Quận Hoàn Kiếm');
  });

  it('turns blank fields into null', () => {
    const c = contactOfKvCustomer(
      kv({ name: '  ', contactNumber: '', email: null, address: null, birthDate: null }),
    );
    expect(c).toMatchObject({ name: '', phone: null, email: null, address: null, birthday: null });
  });
});

describe('phones', () => {
  it('writes a Vietnamese E.164 number the way KiotViet stores it', () => {
    expect(kiotVietPhone('+84912000001')).toBe('0912000001');
    expect(kiotVietPhone('+6591234567')).toBe('+6591234567');
  });

  it('matches a KiotViet number to an E.164 one in any format, any of several numbers', () => {
    expect(matchesPhone('0912 000 001', '+84912000001')).toBe(true);
    expect(matchesPhone('0987000002, 84912000001', '+84912000001')).toBe(true);
    expect(matchesPhone('0912000009', '+84912000001')).toBe(false);
    expect(matchesPhone(null, '+84912000001')).toBe(false);
  });
});

describe('kiotVietCustomerBody', () => {
  it('sends the name, the local number, email, address and branch; leaves out empty ones', () => {
    expect(
      kiotVietCustomerBody(
        { name: 'Lan', phoneE164: '+84901234567', email: null, address: '5 Phố Huế' },
        3,
      ),
    ).toEqual({ name: 'Lan', contactNumber: '0901234567', address: '5 Phố Huế', branchId: 3 });
  });

  it('names a customer without a name by the phone', () => {
    expect(
      kiotVietCustomerBody(
        { name: ' ', phoneE164: '+84901234567', email: 'a@b.vn', address: null },
        1,
      ),
    ).toEqual({ name: '0901234567', contactNumber: '0901234567', email: 'a@b.vn', branchId: 1 });
  });
});
